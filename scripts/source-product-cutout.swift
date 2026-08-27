import AppKit
import CoreImage
import CoreVideo
import Foundation
import Vision

struct OCRLine {
    let text: String
    let box: CGRect
}

struct IdentityAnchor: Codable {
    let productName: String?
    let brandName: String?
    let manufacturer: String?
    let gtin: String?
    let fallbackName: String?
}

struct IdentityMatchEvidence {
    let productTokenCount: Int
    let productNameMatches: Int
    let brandMatches: Int
    let manufacturerMatches: Int
    let gtinExpected: Bool
    let gtinMatch: Bool

    var total: Int {
        productNameMatches + brandMatches + manufacturerMatches + (gtinMatch ? 1 : 0)
    }
}

struct Candidate {
    let inputIndex: Int
    let inputURL: URL
    let method: String
    let score: Double
    let textCount: Int
    let identityMatches: Int
    let productTokenCount: Int
    let productNameMatches: Int
    let brandMatches: Int
    let manufacturerMatches: Int
    let gtinExpected: Bool
    let gtinMatch: Bool
    let evidenceSignals: Int
    let instanceCount: Int
    let retainedRatio: Double
    let boundingCoverage: Double
    let image: CIImage
}

struct CutoutReport: Encodable {
    let inputIndex: Int
    let method: String
    let score: Double
    let textCount: Int
    let identityMatches: Int
    let productTokenCount: Int
    let productNameMatches: Int
    let brandMatches: Int
    let manufacturerMatches: Int
    let gtinExpected: Bool
    let gtinMatch: Bool
    let evidenceSignals: Int
    let instanceCount: Int
    let retainedRatio: Double
    let boundingCoverage: Double
}

enum CutoutError: Error, CustomStringConvertible {
    case usage
    case noSafeCandidate
    case cannotRender
    case transientVisionExecution

    var description: String {
        switch self {
        case .usage:
            return "usage: source-product-cutout <front|evidence|view|subject|alternate> <expected-name> <output.png> <input> [input ...]"
        case .noSafeCandidate:
            return "원본 사진에서 단일 상품 포장을 신뢰도 높게 분리하지 못했습니다. 흰 배경 정면 사진을 추가해 주세요."
        case .cannotRender:
            return "원본 상품 픽셀을 PNG로 렌더링하지 못했습니다."
        case .transientVisionExecution:
            return "SELLERPILOT_TRANSIENT_VISION_FAILURE"
        }
    }
}

func performVision<T>(_ operation: () throws -> T) throws -> T {
    do {
        return try operation()
    } catch {
        // Vision/ANE execution errors are runtime failures, not evidence that
        // the product identity is invalid. Emit only a stable safe marker; the
        // worker owns the single bounded retry and never logs the raw NSError.
        throw CutoutError.transientVisionExecution
    }
}

struct BackgroundGuardReport: Encodable {
    let textCount: Int
    let barcodeCount: Int
    let humanCount: Int
    let packageRectangleCount: Int
    let merchandiseClassificationCount: Int
}

func guardBackground(at inputURL: URL) throws -> BackgroundGuardReport {
    guard let source = CIImage(contentsOf: inputURL),
          source.extent.width >= 120,
          source.extent.height >= 120,
          source.extent.width * source.extent.height <= 16_000_000 else {
        throw CutoutError.noSafeCandidate
    }
    let text = VNRecognizeTextRequest()
    text.recognitionLevel = .accurate
    text.usesLanguageCorrection = false
    text.recognitionLanguages = ["ko-KR", "en-US", "ja-JP"]
    text.minimumTextHeight = 0.012
    let barcodes = VNDetectBarcodesRequest()
    let humans = VNDetectHumanRectanglesRequest()
    humans.upperBodyOnly = false
    let rectangles = VNDetectRectanglesRequest()
    rectangles.maximumObservations = 16
    rectangles.minimumAspectRatio = 0.18
    rectangles.maximumAspectRatio = 1.0
    rectangles.minimumSize = 0.08
    rectangles.minimumConfidence = 0.65
    rectangles.quadratureTolerance = 24
    let classifications = VNClassifyImageRequest()
    let handler = VNImageRequestHandler(url: inputURL, options: [:])
    try performVision { try handler.perform([text, barcodes, humans, rectangles, classifications]) }
    let textCount = (text.results ?? []).filter { observation in
        (observation.topCandidates(1).first?.string.trimmingCharacters(in: .whitespacesAndNewlines).count ?? 0) >= 2
    }.count
    let safeRectangles = (rectangles.results ?? []).filter { observation in
        let area = observation.boundingBox.width * observation.boundingBox.height
        return area >= 0.004 && area <= 0.42
    }
    let packageRectangleCount = safeRectangles.filter { body in
        safeRectangles.contains { cap in
            if body === cap || body.boundingBox.height < cap.boundingBox.height * 1.6 { return false }
            let verticalGap = cap.boundingBox.minY - body.boundingBox.maxY
            let centerDifference = abs(cap.boundingBox.midX - body.boundingBox.midX)
            return verticalGap >= -0.025 && verticalGap <= 0.04
                && cap.boundingBox.width >= body.boundingBox.width * 0.20
                && cap.boundingBox.width <= body.boundingBox.width * 0.82
                && centerDifference <= body.boundingBox.width * 0.18
        }
    }.count
    let merchandiseTerms = [
        "bottle", "beverage_can", "tin_can", "jar", "carton", "package", "packet",
        "pouch", "container", "cosmetics", "snack", "food", "beverage",
    ]
    let merchandiseClassificationCount = (classifications.results ?? []).filter { observation in
        observation.confidence >= 0.08
            && merchandiseTerms.contains(where: { observation.identifier.lowercased().contains($0) })
    }.count
    let report = BackgroundGuardReport(
        textCount: textCount,
        barcodeCount: barcodes.results?.count ?? 0,
        humanCount: humans.results?.count ?? 0,
        packageRectangleCount: packageRectangleCount,
        merchandiseClassificationCount: merchandiseClassificationCount
    )
    guard report.textCount == 0,
          report.barcodeCount == 0,
          report.humanCount == 0,
          report.packageRectangleCount == 0,
          report.merchandiseClassificationCount == 0 else {
        throw CutoutError.noSafeCandidate
    }
    return report
}

func recognizeText(at imageURL: URL) throws -> [OCRLine] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.recognitionLanguages = ["ko-KR", "en-US", "ja-JP"]
    request.minimumTextHeight = 0.009
    let barcodeRequest = VNDetectBarcodesRequest()
    let handler = VNImageRequestHandler(url: imageURL, options: [:])
    try performVision { try handler.perform([request, barcodeRequest]) }
    let textLines: [OCRLine] = (request.results ?? []).compactMap { observation -> OCRLine? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.count >= 2 ? OCRLine(text: text, box: observation.boundingBox) : nil
    }
    var barcodeLines = (barcodeRequest.results ?? []).compactMap { observation -> OCRLine? in
        guard let payload = observation.payloadStringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
              payload.count >= 8 else { return nil }
        return OCRLine(text: payload, box: observation.boundingBox)
    }
    // Phone photos of side/barcode panels are commonly captured a quarter turn.
    // Vision does not always auto-orient a barcode request the same way it does
    // text recognition, so retry the three explicit orientations. A payload is
    // source-file evidence, not a generated guess. We place orientation-only
    // payloads at the frame centre so they can strengthen only a candidate that
    // already covers the primary package object, never a small unrelated crop.
    var barcodePayloads = Set(barcodeLines.map(\.text))
    if let source = CIImage(contentsOf: imageURL) {
      for quarterTurns in 1...3 {
        let orientedRequest = VNDetectBarcodesRequest()
        let angle = CGFloat(quarterTurns) * .pi / 2
        let oriented = normalizedImage(source.transformed(by: CGAffineTransform(rotationAngle: angle)))
        let orientedHandler = VNImageRequestHandler(ciImage: oriented, options: [:])
        guard (try? orientedHandler.perform([orientedRequest])) != nil else { continue }
        for observation in orientedRequest.results ?? [] {
            guard let payload = observation.payloadStringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
                  payload.count >= 8,
                  barcodePayloads.insert(payload).inserted else { continue }
            barcodeLines.append(OCRLine(
                text: payload,
                box: CGRect(x: 0.49, y: 0.49, width: 0.02, height: 0.02)
            ))
        }
      }
    }
    if ProcessInfo.processInfo.environment["SELLERPILOT_CUTOUT_DEBUG"] == "1" {
        FileHandle.standardError.write(Data(
            "ocr file=\(imageURL.lastPathComponent) text=\(textLines.map(\.text).joined(separator: " | ")) barcodes=\(barcodeLines.map(\.text).joined(separator: ","))\n".utf8
        ))
    }
    return textLines + barcodeLines
}

func containedTextCount(_ lines: [OCRLine], in box: CGRect) -> Int {
    let expanded = box.insetBy(dx: -0.018, dy: -0.018)
        .intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
    return lines.filter { line in
        expanded.contains(CGPoint(x: line.box.midX, y: line.box.midY))
    }.count
}

func containedText(_ lines: [OCRLine], in box: CGRect) -> String {
    let expanded = box.insetBy(dx: -0.018, dy: -0.018)
        .intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
    return lines.filter { line in
        expanded.contains(CGPoint(x: line.box.midX, y: line.box.midY))
    }.map(\.text).joined(separator: " ").lowercased()
}

func identityTokens(_ value: String) -> [String] {
    let ignored = Set(["상품", "제품", "식품", "세트", "package", "product", "food"])
    return Array(Set(value.lowercased()
        .components(separatedBy: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "가-힣")).inverted)
        .filter { $0.count >= 2 && !ignored.contains($0) }))
}

func parseIdentityAnchor(_ value: String) -> IdentityAnchor {
    if let data = value.data(using: .utf8),
       let decoded = try? JSONDecoder().decode(IdentityAnchor.self, from: data) {
        return decoded
    }
    return IdentityAnchor(productName: nil, brandName: nil, manufacturer: nil, gtin: nil, fallbackName: value)
}

func anchorProductTokens(_ anchor: IdentityAnchor) -> [String] {
    let confirmed = anchor.productName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let brandAndManufacturer = Set(identityTokens(anchor.brandName ?? "") + identityTokens(anchor.manufacturer ?? ""))
    return identityTokens(confirmed.isEmpty ? (anchor.fallbackName ?? "") : confirmed).filter { token in
        if brandAndManufacturer.contains(token) { return false }
        if token.range(of: #"^\d+(?:[.,]\d+)?(?:g|kg|mg|ml|l|개|캔|포|봉|팩)?$"#, options: .regularExpression) != nil {
            return false
        }
        return true
    }
}

func normalizedDigits(_ value: String?) -> String {
    (value ?? "").filter(\.isNumber)
}

func identityEvidence(_ text: String, anchor: IdentityAnchor) -> IdentityMatchEvidence {
    let normalized = text.lowercased()
    let productTokens = anchorProductTokens(anchor)
    let productMatches = identityMatchCount(normalized, tokens: productTokens)
    let brandMatches = identityMatchCount(normalized, tokens: identityTokens(anchor.brandName ?? ""))
    let manufacturerMatches = identityMatchCount(normalized, tokens: identityTokens(anchor.manufacturer ?? ""))
    let gtin = normalizedDigits(anchor.gtin)
    let gtinMatch = !gtin.isEmpty && normalizedDigits(normalized).contains(gtin)
    return IdentityMatchEvidence(
        productTokenCount: productTokens.count,
        productNameMatches: productMatches,
        brandMatches: brandMatches,
        manufacturerMatches: manufacturerMatches,
        gtinExpected: !gtin.isEmpty,
        gtinMatch: gtinMatch
    )
}

func anchorTokens(_ anchor: IdentityAnchor) -> [String] {
    Array(Set(
        anchorProductTokens(anchor)
            + identityTokens(anchor.brandName ?? "")
            + identityTokens(anchor.manufacturer ?? "")
            + (!normalizedDigits(anchor.gtin).isEmpty ? [normalizedDigits(anchor.gtin)] : [])
    ))
}

func identityMatchCount(_ text: String, tokens: [String]) -> Int {
    tokens.filter { text.contains($0) }.count
}

func evidenceSignalCount(_ text: String) -> Int {
    let normalized = text.lowercased().replacingOccurrences(of: " ", with: "")
    let phrases = [
        "영양정보", "총내용량", "내용량", "원재료", "제조원", "제조업소", "유통전문",
        "품목보고", "소비기한", "보관방법", "반품", "고객상담", "알레르기", "haccp",
        "kcal", "탄수화물", "단백질", "지방", "나트륨", "바코드",
    ]
    var count = phrases.filter { normalized.contains($0) }.count
    if normalized.range(of: #"\d{8,}"#, options: .regularExpression) != nil { count += 2 }
    if normalized.range(of: #"\d+(\.\d+)?(g|mg|kg|ml|%)"#, options: .regularExpression) != nil { count += 1 }
    return count
}

func normalizedCenterScore(_ box: CGRect) -> Double {
    let distance = hypot(box.midX - 0.5, box.midY - 0.5)
    return max(0, 1 - distance / 0.72)
}

func printedIdentityScore(_ textCount: Int, denseIdentityIsExpected: Bool) -> Double {
    let useful = min(textCount, 10)
    let densePanelPenalty = denseIdentityIsExpected ? 0 : max(0, textCount - 18)
    return Double(useful) * 2.4 - Double(densePanelPenalty) * 0.8
}

func candidateScore(
    mode: String,
    textCount: Int,
    identityMatches: Int,
    identityEvidence: IdentityMatchEvidence,
    evidenceSignals: Int,
    box: CGRect,
    area: Double,
    confidence: Double,
    inputIndex: Int,
    instanceCount: Int,
    method: String
) -> Double? {
    let areaPreference = 1 - min(1, abs(area - 0.28) / 0.48)
    if mode == "front" {
        let densityIsSafe = textCount <= 32 || (identityMatches >= 2 && textCount <= 48)
        let requiredProductMatches = min(3, identityEvidence.productTokenCount)
        let fieldLinked = identityEvidence.gtinMatch
            || (requiredProductMatches >= 1
                && identityEvidence.productNameMatches >= requiredProductMatches
                && (requiredProductMatches >= 3
                    || identityEvidence.brandMatches + identityEvidence.manufacturerMatches >= 1))
        guard fieldLinked, textCount >= 2, densityIsSafe else { return nil }
        return Double(identityMatches) * 9
            + printedIdentityScore(textCount, denseIdentityIsExpected: identityMatches >= 2)
            + normalizedCenterScore(box) * 4
            + areaPreference * 2
            + confidence * 2
            + (method == "single-instance" && instanceCount == 1 ? 1.5 : 0)
            - Double(inputIndex) * 0.08
    }
    if mode == "evidence" {
        // A dense nutrition/legal panel is not sufficient provenance by itself:
        // another product can expose the same generic headings and package color.
        // Require at least one seller-confirmed name/brand/manufacturer/GTIN token
        // before the panel is eligible for selection at all.
        let requiredProductMatches = min(2, identityEvidence.productTokenCount)
        let fieldLinked = identityEvidence.gtinExpected
            ? identityEvidence.gtinMatch
            : requiredProductMatches >= 1
                && identityEvidence.productNameMatches >= requiredProductMatches
                && identityEvidence.brandMatches + identityEvidence.manufacturerMatches >= 1
        guard textCount >= 6, fieldLinked,
              evidenceSignals >= 1 || identityEvidence.gtinMatch || identityEvidence.productNameMatches >= 2 else { return nil }
        return Double(identityMatches) * 14
            + Double(min(textCount, 40)) * 0.7
            + Double(evidenceSignals) * 4
            + normalizedCenterScore(box) * 2
            + areaPreference
            + confidence
            + (method == "rectangle" ? 18 : 0)
            + Double(inputIndex) * 0.08
    }
    if mode == "view" {
        let requiredProductMatches = min(2, identityEvidence.productTokenCount)
        let fieldLinked = identityEvidence.gtinMatch
            || (requiredProductMatches >= 1
                && identityEvidence.productNameMatches >= requiredProductMatches
                && identityEvidence.brandMatches + identityEvidence.manufacturerMatches >= 1)
        guard textCount >= 2, fieldLinked else { return nil }
        return Double(identityMatches) * 7
            + Double(evidenceSignals) * 3
            + Double(min(textCount, 24)) * 0.8
            + normalizedCenterScore(box) * 3
            + areaPreference
            + confidence
    }
    guard (mode == "subject" || mode == "alternate"), method == "single-instance", instanceCount == 1 else {
        return nil
    }
    return normalizedCenterScore(box) * 5
        + areaPreference * 2
        + min(1, area / 0.20) * 2
        + (mode == "alternate" ? Double(inputIndex) * 0.04 : -Double(inputIndex) * 0.04)
}

func imagePoint(_ point: CGPoint, extent: CGRect) -> CIVector {
    CIVector(
        x: extent.minX + point.x * extent.width,
        y: extent.minY + point.y * extent.height
    )
}

func insetRectanglePoint(_ point: CGPoint, center: CGPoint, fraction: CGFloat) -> CGPoint {
    CGPoint(
        x: point.x + (center.x - point.x) * fraction,
        y: point.y + (center.y - point.y) * fraction
    )
}

func rectangleCandidates(inputIndex: Int, inputURL: URL, source: CIImage, lines: [OCRLine], mode: String, anchor: IdentityAnchor, tokens: [String]) throws -> [Candidate] {
    if mode == "subject" || mode == "alternate" { return [] }
    let request = VNDetectRectanglesRequest()
    request.maximumObservations = 16
    request.minimumAspectRatio = 0.22
    request.maximumAspectRatio = 1.0
    request.minimumSize = 0.12
    request.minimumConfidence = 0.45
    request.quadratureTolerance = 34
    let handler = VNImageRequestHandler(url: inputURL, options: [:])
    try performVision { try handler.perform([request]) }
    return (request.results ?? []).compactMap { rectangle in
        let box = rectangle.boundingBox
        let area = box.width * box.height
        let textCount = containedTextCount(lines, in: box)
        let candidateText = containedText(lines, in: box)
        let identityMatches = identityMatchCount(candidateText, tokens: tokens)
        let matchEvidence = identityEvidence(candidateText, anchor: anchor)
        let evidenceSignals = evidenceSignalCount(candidateText)
        if ProcessInfo.processInfo.environment["SELLERPILOT_CUTOUT_DEBUG"] == "1" {
            FileHandle.standardError.write(Data(
                "rectangle-raw input=\(inputIndex) confidence=\(rectangle.confidence) area=\(area) box=\(box) text=\(textCount) identity=\(identityMatches)\n".utf8
            ))
        }
        let edgeIsSafe = mode == "evidence" || (
            box.minX > 0.018 && box.minY > 0.018
                && box.maxX < 0.982 && box.maxY < 0.982
        )
        guard area >= 0.055, area <= (mode == "evidence" ? 0.96 : 0.68),
              edgeIsSafe,
              textCount >= 2,
              let filter = CIFilter(name: "CIPerspectiveCorrection") else {
            return nil
        }
        filter.setValue(source, forKey: kCIInputImageKey)
        let center = CGPoint(
            x: (rectangle.topLeft.x + rectangle.topRight.x + rectangle.bottomLeft.x + rectangle.bottomRight.x) / 4,
            y: (rectangle.topLeft.y + rectangle.topRight.y + rectangle.bottomLeft.y + rectangle.bottomRight.y) / 4
        )
        // Evidence photos are frequently hand-held. Crop safely inside the
        // detected printed panel so fingers, arms, shelves and neighbouring
        // packages outside the face cannot become source evidence pixels.
        // A detected legal/marketing face may still include fingers just outside
        // the printed box edge (Vision's quadrilateral is deliberately tolerant).
        // Keep only the inner panel: losing a narrow decorative border is safer
        // than letting a hand or neighbouring shelf become trusted source pixels.
        let inset: CGFloat = mode == "evidence" ? 0.24 : 0
        filter.setValue(imagePoint(insetRectanglePoint(rectangle.topLeft, center: center, fraction: inset), extent: source.extent), forKey: "inputTopLeft")
        filter.setValue(imagePoint(insetRectanglePoint(rectangle.topRight, center: center, fraction: inset), extent: source.extent), forKey: "inputTopRight")
        filter.setValue(imagePoint(insetRectanglePoint(rectangle.bottomLeft, center: center, fraction: inset), extent: source.extent), forKey: "inputBottomLeft")
        filter.setValue(imagePoint(insetRectanglePoint(rectangle.bottomRight, center: center, fraction: inset), extent: source.extent), forKey: "inputBottomRight")
        guard let corrected = filter.outputImage,
              corrected.extent.width >= 120,
              corrected.extent.height >= 120 else {
            return nil
        }
        let correctedAspect = corrected.extent.width / corrected.extent.height
        guard correctedAspect >= 0.28, correctedAspect <= 2.6 else { return nil }
        guard let score = candidateScore(
            mode: mode,
            textCount: textCount,
            identityMatches: identityMatches,
            identityEvidence: matchEvidence,
            evidenceSignals: evidenceSignals,
            box: box,
            area: Double(area),
            confidence: Double(rectangle.confidence),
            inputIndex: inputIndex,
            instanceCount: 1,
            method: "rectangle"
        ) else { return nil }
        return Candidate(
            inputIndex: inputIndex,
            inputURL: inputURL,
            method: "rectangle",
            score: score,
            textCount: textCount,
            identityMatches: identityMatches,
            productTokenCount: matchEvidence.productTokenCount,
            productNameMatches: matchEvidence.productNameMatches,
            brandMatches: matchEvidence.brandMatches,
            manufacturerMatches: matchEvidence.manufacturerMatches,
            gtinExpected: matchEvidence.gtinExpected,
            gtinMatch: matchEvidence.gtinMatch,
            evidenceSignals: evidenceSignals,
            instanceCount: 1,
            retainedRatio: Double(area),
            boundingCoverage: 1,
            image: corrected
        )
    }
}

struct MaskStats {
    let count: Int
    let minX: Int
    let minY: Int
    let maxX: Int
    let maxY: Int
    let width: Int
    let height: Int

    var ratio: Double { Double(count) / Double(width * height) }
    var normalizedBox: CGRect {
        CGRect(
            x: Double(minX) / Double(width),
            y: 1 - Double(maxY + 1) / Double(height),
            width: Double(maxX - minX + 1) / Double(width),
            height: Double(maxY - minY + 1) / Double(height)
        )
    }
}

func maskStats(_ pixelBuffer: CVPixelBuffer) -> MaskStats? {
    CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(pixelBuffer) else { return nil }
    let width = CVPixelBufferGetWidth(pixelBuffer)
    let height = CVPixelBufferGetHeight(pixelBuffer)
    let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
    let pixelFormat = CVPixelBufferGetPixelFormatType(pixelBuffer)
    var count = 0
    var minX = width
    var minY = height
    var maxX = -1
    var maxY = -1
    let retain = { (x: Int, y: Int) -> Bool in
        let row = base.advanced(by: y * bytesPerRow)
        if pixelFormat == kCVPixelFormatType_OneComponent32Float {
            return row.assumingMemoryBound(to: Float.self)[x] >= 0.5
        }
        if pixelFormat == kCVPixelFormatType_OneComponent8 {
            return row.assumingMemoryBound(to: UInt8.self)[x] >= 128
        }
        return false
    }
    guard pixelFormat == kCVPixelFormatType_OneComponent32Float
        || pixelFormat == kCVPixelFormatType_OneComponent8 else { return nil }
    for y in 0..<height {
        for x in 0..<width where retain(x, y) {
            count += 1
            minX = min(minX, x)
            minY = min(minY, y)
            maxX = max(maxX, x)
            maxY = max(maxY, y)
        }
    }
    guard count > 0, maxX >= minX, maxY >= minY else { return nil }
    return MaskStats(count: count, minX: minX, minY: minY, maxX: maxX, maxY: maxY, width: width, height: height)
}

func textGuidedMaskCrop(_ lines: [OCRLine], instanceBox: CGRect, boundingCoverage: Double) -> CGRect? {
    if boundingCoverage >= 0.90 { return instanceBox }
    let contained = lines.filter { line in
        instanceBox.contains(CGPoint(x: line.box.midX, y: line.box.midY))
    }
    guard contained.count >= 8 else { return nil }
    let textBox = contained.dropFirst().reduce(contained[0].box) { partial, line in
        partial.union(line.box)
    }
    let targetWidth = min(instanceBox.width, max(textBox.width * 1.18, instanceBox.width * 0.78))
    let targetHeight = min(instanceBox.height, max(textBox.height * 1.14, instanceBox.height * 0.90))
    let proposed = CGRect(
        x: textBox.midX - targetWidth / 2,
        y: textBox.midY - targetHeight / 2,
        width: targetWidth,
        height: targetHeight
    )
    let originX = min(max(proposed.minX, instanceBox.minX), instanceBox.maxX - targetWidth)
    let originY = min(max(proposed.minY, instanceBox.minY), instanceBox.maxY - targetHeight)
    return CGRect(x: originX, y: originY, width: targetWidth, height: targetHeight)
}

func maskedImage(source: CIImage, maskBuffer: CVPixelBuffer, stats: MaskStats, cropBox: CGRect) -> CIImage? {
    let mask = CIImage(cvPixelBuffer: maskBuffer)
    let clear = CIImage(color: CIColor.clear).cropped(to: source.extent)
    guard let blend = CIFilter(name: "CIBlendWithMask") else { return nil }
    blend.setValue(source, forKey: kCIInputImageKey)
    blend.setValue(clear, forKey: kCIInputBackgroundImageKey)
    blend.setValue(mask, forKey: kCIInputMaskImageKey)
    guard let output = blend.outputImage?.cropped(to: source.extent) else { return nil }
    let box = cropBox
    let paddingX = min(0.02, box.width * 0.04)
    let paddingY = min(0.02, box.height * 0.04)
    let padded = box.insetBy(dx: -paddingX, dy: -paddingY)
        .intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
    let crop = CGRect(
        x: source.extent.minX + padded.minX * source.extent.width,
        y: source.extent.minY + padded.minY * source.extent.height,
        width: padded.width * source.extent.width,
        height: padded.height * source.extent.height
    ).intersection(source.extent)
    return crop.width >= 120 && crop.height >= 120 ? output.cropped(to: crop) : nil
}

func instanceCandidates(inputIndex: Int, inputURL: URL, source: CIImage, lines: [OCRLine], mode: String, anchor: IdentityAnchor, tokens: [String]) throws -> [Candidate] {
    let request = VNGenerateForegroundInstanceMaskRequest()
    let handler = VNImageRequestHandler(url: inputURL, options: [:])
    try performVision { try handler.perform([request]) }
    guard let observation = request.results?.first else { return [] }
    let instanceCount = observation.allInstances.count
    return try observation.allInstances.compactMap { instance in
        let instances = IndexSet(integer: instance)
        let maskBuffer = try performVision {
            try observation.generateScaledMaskForImage(forInstances: instances, from: handler)
        }
        guard let stats = maskStats(maskBuffer) else { return nil }
        let box = stats.normalizedBox
        let textCount = containedTextCount(lines, in: box)
        let candidateText = containedText(lines, in: box)
        let identityMatches = identityMatchCount(candidateText, tokens: tokens)
        let matchEvidence = identityEvidence(candidateText, anchor: anchor)
        let evidenceSignals = evidenceSignalCount(candidateText)
        let boundingCoverage = stats.ratio / max(0.0001, box.width * box.height)
        let singleObjectMode = mode == "subject" || mode == "alternate"
        let maximumRatio = mode == "evidence" ? 0.90 : (singleObjectMode ? 0.70 : (instanceCount == 1 ? 0.82 : 0.55))
        let coverageIsSafe = singleObjectMode ? instanceCount == 1 && boundingCoverage <= 0.96 : (instanceCount == 1 || boundingCoverage <= 0.94)
        let edgeIsSafe = mode == "evidence" || (
            box.minX > 0.008 && box.minY > 0.008
                && box.maxX < 0.992 && box.maxY < 0.992
        )
        if ProcessInfo.processInfo.environment["SELLERPILOT_CUTOUT_DEBUG"] == "1" {
            let format = CVPixelBufferGetPixelFormatType(maskBuffer)
            FileHandle.standardError.write(Data(
                "instance-raw input=\(inputIndex) instance=\(instance) total=\(instanceCount) format=\(format) ratio=\(stats.ratio) box=\(box) coverage=\(boundingCoverage) text=\(textCount) identity=\(identityMatches)\n".utf8
            ))
        }
        let cropBox = singleObjectMode ? box : textGuidedMaskCrop(lines, instanceBox: box, boundingCoverage: boundingCoverage)
        guard let cropBox,
              stats.ratio >= 0.025, stats.ratio <= maximumRatio,
              edgeIsSafe,
              coverageIsSafe,
              (singleObjectMode || textCount >= 2),
              let output = maskedImage(source: source, maskBuffer: maskBuffer, stats: stats, cropBox: cropBox) else {
            return nil
        }
        guard let score = candidateScore(
            mode: mode,
            textCount: textCount,
            identityMatches: identityMatches,
            identityEvidence: matchEvidence,
            evidenceSignals: evidenceSignals,
            box: box,
            area: stats.ratio,
            confidence: 0,
            inputIndex: inputIndex,
            instanceCount: instanceCount,
            method: "single-instance"
        ) else { return nil }
        return Candidate(
            inputIndex: inputIndex,
            inputURL: inputURL,
            method: "single-instance",
            score: score,
            textCount: textCount,
            identityMatches: identityMatches,
            productTokenCount: matchEvidence.productTokenCount,
            productNameMatches: matchEvidence.productNameMatches,
            brandMatches: matchEvidence.brandMatches,
            manufacturerMatches: matchEvidence.manufacturerMatches,
            gtinExpected: matchEvidence.gtinExpected,
            gtinMatch: matchEvidence.gtinMatch,
            evidenceSignals: evidenceSignals,
            instanceCount: instanceCount,
            retainedRatio: stats.ratio,
            boundingCoverage: boundingCoverage,
            image: output
        )
    }
}

func normalizedImage(_ image: CIImage) -> CIImage {
    image.transformed(
        by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY)
    )
}

struct RecognitionScore {
    let horizontal: Double
    let confidence: Double
    let count: Int
    let identityMatches: Int
    let text: String
    let bottomFactScore: Double
    let topHeadingScore: Double
}

func recognitionScore(_ image: CIImage, tokens: [String]) -> RecognitionScore {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.recognitionLanguages = ["ko-KR", "en-US", "ja-JP"]
    request.minimumTextHeight = 0.009
    let handler = VNImageRequestHandler(ciImage: normalizedImage(image), options: [:])
    guard (try? handler.perform([request])) != nil else {
        return RecognitionScore(horizontal: 0, confidence: 0, count: 0, identityMatches: 0, text: "", bottomFactScore: 0, topHeadingScore: 0)
    }
    let recognized = (request.results ?? []).compactMap { observation -> (String, VNRecognizedTextObservation, Float)? in
        guard let candidate = observation.topCandidates(1).first,
              candidate.string.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2 else {
            return nil
        }
        return (candidate.string, observation, candidate.confidence)
    }
    let combinedText = recognized.map(\.0).joined(separator: " ").lowercased()
    return recognized.reduce(RecognitionScore(
        horizontal: 0,
        confidence: 0,
        count: 0,
        identityMatches: identityMatchCount(combinedText, tokens: tokens),
        text: combinedText,
        bottomFactScore: 0,
        topHeadingScore: 0
    )) { score, item in
        let (text, observation, confidence) = item
        let aspect = Double(observation.boundingBox.width / max(0.0001, observation.boundingBox.height))
        let horizontal = min(4, max(0, aspect - 0.8)) * (0.5 + Double(confidence))
        let normalizedText = text.lowercased().replacingOccurrences(of: " ", with: "")
        let hasPackageFact = normalizedText.range(
            of: #"\d[\d.,]*(g|kg|ml|l|kcal|개|포|봉|캔)"#,
            options: .regularExpression
        ) != nil || normalizedText.contains("haccp") || normalizedText.contains("식품안전")
        let bottomFactScore = hasPackageFact
            ? Double(1 - observation.boundingBox.midY) * (0.5 + Double(confidence))
            : 0
        let hasEvidenceHeading = ["영양정보", "원재료", "제품명", "주의사항", "사용방법"]
            .contains(where: { normalizedText.contains($0) })
        let topHeadingScore = hasEvidenceHeading
            ? Double(observation.boundingBox.midY) * (0.5 + Double(confidence))
            : 0
        return RecognitionScore(
            horizontal: score.horizontal + horizontal,
            confidence: score.confidence + Double(confidence),
            count: score.count + 1,
            identityMatches: score.identityMatches,
            text: score.text,
            bottomFactScore: score.bottomFactScore + bottomFactScore,
            topHeadingScore: score.topHeadingScore + topHeadingScore
        )
    }
}

func uprightImage(_ image: CIImage, tokens: [String], mode: String) throws -> CIImage {
    let rotations = [0, 1, 2, 3].map { quarterTurns -> (image: CIImage, turns: Int, score: RecognitionScore) in
        let angle = CGFloat(quarterTurns) * .pi / 2
        let rotated = normalizedImage(image.transformed(by: CGAffineTransform(rotationAngle: angle)))
        return (rotated, quarterTurns, recognitionScore(rotated, tokens: tokens))
    }
    if ProcessInfo.processInfo.environment["SELLERPILOT_CUTOUT_DEBUG"] == "1" {
        for rotation in rotations {
            FileHandle.standardError.write(Data(
                "orientation turns=\(rotation.turns) horizontal=\(rotation.score.horizontal) confidence=\(rotation.score.confidence) count=\(rotation.score.count) identity=\(rotation.score.identityMatches) bottomFacts=\(rotation.score.bottomFactScore) topHeadings=\(rotation.score.topHeadingScore) text=\(rotation.score.text)\n".utf8
            ))
        }
    }
    let original = rotations[0]
    // Product photos are expected to arrive upright; only correct a package that
    // was physically held a quarter turn (for example a landscape carton in a
    // portrait photo). Never auto-flip 180 degrees because OCR confidence alone
    // cannot distinguish an upright legal panel from its upside-down twin.
    let quarterTurnCandidates = rotations.filter { $0.turns != 2 }
    guard let best = quarterTurnCandidates.max(by: { left, right in
        if abs(left.score.horizontal - right.score.horizontal) > 0.25 {
            return left.score.horizontal < right.score.horizontal
        }
        if abs(left.score.confidence - right.score.confidence) > 0.5 {
            return left.score.confidence < right.score.confidence
        }
        return left.turns > right.turns
    }) else { throw CutoutError.noSafeCandidate }
    let materiallyBetter = best.score.horizontal >= original.score.horizontal + 2.5
        && best.score.horizontal >= original.score.horizontal * 1.15
    if best.turns == 0 || !materiallyBetter { return original.image }
    let oddRotations = rotations.filter { $0.turns == 1 || $0.turns == 3 }
    let evidenceHeadingDifference = oddRotations[0].score.topHeadingScore - oddRotations[1].score.topHeadingScore
    guard let directed = oddRotations.max(by: {
        if mode == "evidence" && abs(evidenceHeadingDifference) >= 0.12 {
            return $0.score.topHeadingScore < $1.score.topHeadingScore
        }
        if abs($0.score.bottomFactScore - $1.score.bottomFactScore) > 0.12 {
            return $0.score.bottomFactScore < $1.score.bottomFactScore
        }
        return $0.turns > $1.turns
    }),
    (mode == "evidence" && abs(evidenceHeadingDifference) >= 0.12)
        || abs(oddRotations[0].score.bottomFactScore - oddRotations[1].score.bottomFactScore) >= 0.12 else {
        throw CutoutError.noSafeCandidate
    }
    return directed.image
}

func render(_ image: CIImage, tokens: [String], mode: String, to outputURL: URL) throws {
    let normalized = try uprightImage(image, tokens: tokens, mode: mode)
    guard normalized.extent.width >= 120,
          normalized.extent.height >= 120,
          let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) else {
        throw CutoutError.cannotRender
    }
    try CIContext(options: [.useSoftwareRenderer: false]).writePNGRepresentation(
        of: normalized,
        to: outputURL,
        format: .RGBA8,
        colorSpace: colorSpace
    )
}

func run() throws {
    if CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "background" {
        let report = try guardBackground(at: URL(fileURLWithPath: CommandLine.arguments[2]))
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        FileHandle.standardOutput.write(try encoder.encode(report))
        FileHandle.standardOutput.write(Data("\n".utf8))
        return
    }
    guard CommandLine.arguments.count >= 5 else { throw CutoutError.usage }
    let mode = CommandLine.arguments[1]
    guard ["front", "evidence", "view", "subject", "alternate"].contains(mode) else { throw CutoutError.usage }
    let anchor = parseIdentityAnchor(CommandLine.arguments[2])
    let tokens = anchorTokens(anchor)
    if mode == "front" && tokens.isEmpty { throw CutoutError.noSafeCandidate }
    let outputURL = URL(fileURLWithPath: CommandLine.arguments[3])
    let inputURLs = CommandLine.arguments.dropFirst(4).map { URL(fileURLWithPath: $0) }
    guard inputURLs.count <= 8 else { throw CutoutError.noSafeCandidate }
    var candidates: [Candidate] = []
    for (index, inputURL) in inputURLs.enumerated() {
        guard let source = CIImage(contentsOf: inputURL),
              source.extent.width >= 120,
              source.extent.height >= 120,
              source.extent.width * source.extent.height <= 16_000_000 else { continue }
        let lines = try recognizeText(at: inputURL)
        candidates.append(contentsOf: try rectangleCandidates(
            inputIndex: index,
            inputURL: inputURL,
            source: source,
            lines: lines,
            mode: mode,
            anchor: anchor,
            tokens: tokens
        ))
        candidates.append(contentsOf: try instanceCandidates(
            inputIndex: index,
            inputURL: inputURL,
            source: source,
            lines: lines,
            mode: mode,
            anchor: anchor,
            tokens: tokens
        ))
        candidates = Array(candidates.sorted { $0.score > $1.score }.prefix(24))
    }
    let ranked = candidates.sorted { left, right in
        if mode == "front",
           left.identityMatches == right.identityMatches,
           left.inputIndex != right.inputIndex,
           abs(left.score - right.score) <= 1.25 {
            return left.inputIndex < right.inputIndex
        }
        if abs(left.score - right.score) > 0.001 { return left.score > right.score }
        if left.method != right.method { return left.method == "rectangle" }
        return left.inputIndex < right.inputIndex
    }
    if ProcessInfo.processInfo.environment["SELLERPILOT_CUTOUT_DEBUG"] == "1" {
        for candidate in ranked.prefix(40) {
            FileHandle.standardError.write(Data(
                "candidate input=\(candidate.inputIndex) method=\(candidate.method) score=\(candidate.score) text=\(candidate.textCount) identity=\(candidate.identityMatches) evidence=\(candidate.evidenceSignals) instances=\(candidate.instanceCount) ratio=\(candidate.retainedRatio)\n".utf8
            ))
        }
    }
    guard let primary = ranked.first else { throw CutoutError.noSafeCandidate }
    let selected: Candidate
    if mode == "front" || mode == "view" {
        // A text-rich detected package face is safer than a foreground mask:
        // the latter can join a display stand or a hand to the package. Keep the
        // semantically selected input, then prefer its perspective-corrected face
        // only when it retains most of the verified front text.
        let minimumFaceText = max(6, Int((Double(primary.textCount) * 0.6).rounded(.down)))
        selected = ranked.first(where: { candidate in
            candidate.inputIndex == primary.inputIndex
                && candidate.method == "rectangle"
                && (candidate.identityMatches >= 1 || (mode == "view" && candidate.evidenceSignals >= 1))
                && candidate.textCount >= minimumFaceText
                && candidate.retainedRatio >= 0.10
                && candidate.retainedRatio >= primary.retainedRatio * 0.72
        }) ?? primary
    } else {
        selected = primary
    }
    let minimumScore: Double = mode == "front" ? 20 : (mode == "evidence" ? 9 : (mode == "view" ? 10 : 8))
    guard selected.score >= minimumScore else {
        throw CutoutError.noSafeCandidate
    }
    try render(selected.image, tokens: tokens, mode: mode, to: outputURL)
    let report = CutoutReport(
        inputIndex: selected.inputIndex,
        method: selected.method,
        score: selected.score,
        textCount: selected.textCount,
        identityMatches: selected.identityMatches,
        productTokenCount: selected.productTokenCount,
        productNameMatches: selected.productNameMatches,
        brandMatches: selected.brandMatches,
        manufacturerMatches: selected.manufacturerMatches,
        gtinExpected: selected.gtinExpected,
        gtinMatch: selected.gtinMatch,
        evidenceSignals: selected.evidenceSignals,
        instanceCount: selected.instanceCount,
        retainedRatio: selected.retainedRatio,
        boundingCoverage: selected.boundingCoverage
    )
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    FileHandle.standardOutput.write(try encoder.encode(report))
    FileHandle.standardOutput.write(Data("\n".utf8))
}

do {
    try run()
} catch {
    FileHandle.standardError.write(Data("\(error)\n".utf8))
    exit(1)
}
