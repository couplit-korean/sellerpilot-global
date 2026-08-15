import AVFoundation
import Foundation
import ImageIO
import UniformTypeIdentifiers

let videoURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputDirectory = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)

let asset = AVAsset(url: videoURL)
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.requestedTimeToleranceBefore = .zero
generator.requestedTimeToleranceAfter = .zero

for second in [1.0, 9.5, 12.0, 15.0, 19.0] {
    let time = CMTime(seconds: second, preferredTimescale: 600)
    let image = try generator.copyCGImage(at: time, actualTime: nil)
    let fileName = String(format: "frame-%04.1f.png", second)
    let destinationURL = outputDirectory.appendingPathComponent(fileName) as CFURL
    guard let destination = CGImageDestinationCreateWithURL(destinationURL, UTType.png.identifier as CFString, 1, nil) else {
        throw NSError(domain: "SellerPilotVideo", code: 1)
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else {
        throw NSError(domain: "SellerPilotVideo", code: 2)
    }
    print(fileName)
}
