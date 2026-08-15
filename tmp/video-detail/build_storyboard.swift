import Foundation
import AVFoundation
import CoreGraphics
import CoreMedia
import CoreVideo
import ImageIO

let fileManager = FileManager.default
let workingDirectory = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ".", isDirectory: true)
let outputURL = URL(fileURLWithPath: CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "sellerpilot-detail-demo.mp4")
let captureDirectory = workingDirectory.appendingPathComponent("captures", isDirectory: true)

let width = 1920
let height = 1080
let framesPerSecond: Int32 = 30

func loadImage(_ fileName: String) throws -> CGImage {
    let url = captureDirectory.appendingPathComponent(fileName) as CFURL
    guard let source = CGImageSourceCreateWithURL(url, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw NSError(domain: "SellerPilotVideo", code: 1, userInfo: [NSLocalizedDescriptionKey: "이미지를 불러오지 못했습니다: \(fileName)"])
    }
    return image
}

let idle = try loadImage("01-idle.png")
let quality = try loadImage("02-quality.png")
let reading = try loadImage("03-reading.png")
let detailGenerating = try loadImage("04-detail-generating.png")
let channelPreparing = try loadImage("05-channel-preparing.png")
let complete = try loadImage("06-complete.png")
let korean = try loadImage("07-korean.png")
let japanese = try loadImage("08-japanese.png")
let english = try loadImage("09-english.png")
let malay = try loadImage("10-malay.png")

if fileManager.fileExists(atPath: outputURL.path) {
    try fileManager.removeItem(at: outputURL)
}

let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
let compression: [String: Any] = [
    AVVideoAverageBitRateKey: 16_000_000,
    AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
    AVVideoExpectedSourceFrameRateKey: framesPerSecond,
    AVVideoMaxKeyFrameIntervalKey: framesPerSecond * 2,
]
let settings: [String: Any] = [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: width,
    AVVideoHeightKey: height,
    AVVideoCompressionPropertiesKey: compression,
]
let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
input.expectsMediaDataInRealTime = false
let attributes: [String: Any] = [
    kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA),
    kCVPixelBufferWidthKey as String: width,
    kCVPixelBufferHeightKey as String: height,
]
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: attributes)

guard writer.canAdd(input) else {
    throw NSError(domain: "SellerPilotVideo", code: 2, userInfo: [NSLocalizedDescriptionKey: "비디오 입력을 추가할 수 없습니다."])
}
writer.add(input)
guard writer.startWriting() else { throw writer.error ?? NSError(domain: "SellerPilotVideo", code: 3) }
writer.startSession(atSourceTime: .zero)

var frameIndex: Int64 = 0

func draw(_ image: CGImage, in context: CGContext, alpha: CGFloat, scale: CGFloat) {
    let scaledWidth = CGFloat(width) * scale
    let scaledHeight = CGFloat(height) * scale
    let rect = CGRect(
        x: (CGFloat(width) - scaledWidth) / 2,
        y: (CGFloat(height) - scaledHeight) / 2,
        width: scaledWidth,
        height: scaledHeight
    )
    context.saveGState()
    context.interpolationQuality = .high
    context.setAlpha(alpha)
    context.draw(image, in: rect)
    context.restoreGState()
}

func appendFrame(_ first: CGImage, _ second: CGImage? = nil, mix: CGFloat = 0, scale: CGFloat = 1) throws {
    while !input.isReadyForMoreMediaData { usleep(1_000) }
    guard let pool = adaptor.pixelBufferPool else {
        throw NSError(domain: "SellerPilotVideo", code: 4, userInfo: [NSLocalizedDescriptionKey: "픽셀 버퍼 풀이 없습니다."])
    }
    var maybeBuffer: CVPixelBuffer?
    guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &maybeBuffer) == kCVReturnSuccess,
          let buffer = maybeBuffer else {
        throw NSError(domain: "SellerPilotVideo", code: 5, userInfo: [NSLocalizedDescriptionKey: "픽셀 버퍼를 만들지 못했습니다."])
    }

    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
    guard let address = CVPixelBufferGetBaseAddress(buffer) else {
        throw NSError(domain: "SellerPilotVideo", code: 6)
    }
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let bitmapInfo = CGBitmapInfo.byteOrder32Little.union(CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedFirst.rawValue))
    guard let context = CGContext(
        data: address,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
        space: colorSpace,
        bitmapInfo: bitmapInfo.rawValue
    ) else {
        throw NSError(domain: "SellerPilotVideo", code: 7, userInfo: [NSLocalizedDescriptionKey: "그리기 컨텍스트를 만들지 못했습니다."])
    }

    context.setFillColor(CGColor(gray: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    draw(first, in: context, alpha: second == nil ? 1 : 1 - mix, scale: scale)
    if let second { draw(second, in: context, alpha: mix, scale: scale) }

    let time = CMTime(value: frameIndex, timescale: framesPerSecond)
    guard adaptor.append(buffer, withPresentationTime: time) else {
        throw writer.error ?? NSError(domain: "SellerPilotVideo", code: 8, userInfo: [NSLocalizedDescriptionKey: "비디오 프레임을 추가하지 못했습니다."])
    }
    frameIndex += 1
}

func hold(_ image: CGImage, frames: Int, startScale: CGFloat = 1, endScale: CGFloat = 1) throws {
    for index in 0..<frames {
        let position = frames == 1 ? 0 : CGFloat(index) / CGFloat(frames - 1)
        let scale = startScale + (endScale - startScale) * position
        try appendFrame(image, scale: scale)
    }
}

func transition(_ first: CGImage, _ second: CGImage, frames: Int) throws {
    for index in 0..<frames {
        let raw = CGFloat(index) / CGFloat(max(1, frames - 1))
        let eased = raw * raw * (3 - 2 * raw)
        try appendFrame(first, second, mix: eased)
    }
}

// 총 600프레임 = 30fps 기준 정확히 20초.
try hold(idle, frames: 60, startScale: 1, endScale: 1.006)
try transition(idle, quality, frames: 10)
try hold(quality, frames: 22)
try transition(quality, reading, frames: 8)
try hold(reading, frames: 22)
try transition(reading, detailGenerating, frames: 8)
try hold(detailGenerating, frames: 22)
try transition(detailGenerating, channelPreparing, frames: 8)
try hold(channelPreparing, frames: 22)
try transition(channelPreparing, complete, frames: 12)
try hold(complete, frames: 70, startScale: 1, endScale: 1.008)
try transition(complete, korean, frames: 12)
try hold(korean, frames: 65, startScale: 1, endScale: 1.006)
try transition(korean, japanese, frames: 8)
try hold(japanese, frames: 65, startScale: 1, endScale: 1.006)
try transition(japanese, english, frames: 8)
try hold(english, frames: 65, startScale: 1, endScale: 1.006)
try transition(english, malay, frames: 8)
try hold(malay, frames: 105, startScale: 1, endScale: 1.008)

input.markAsFinished()
let semaphore = DispatchSemaphore(value: 0)
writer.finishWriting { semaphore.signal() }
semaphore.wait()

guard writer.status == .completed else {
    throw writer.error ?? NSError(domain: "SellerPilotVideo", code: 9, userInfo: [NSLocalizedDescriptionKey: "비디오 저장이 완료되지 않았습니다."])
}

print("created=\(outputURL.path)")
print("frames=\(frameIndex)")
print("duration=\(Double(frameIndex) / Double(framesPerSecond))")
