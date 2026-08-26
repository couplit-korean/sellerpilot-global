import Foundation
import CoreImage
import Vision

private let maximumReferenceImages = 12
private let maximumReferenceLines = 120
private let maximumCandidateLines = 60

struct FidelityReport: Encodable {
    let referenceLines: [String]
    let candidateLines: [String]
    let referenceTokens: [String]
    let requiredTokens: [String]
    let candidateTokens: [String]
    let unsupportedTokens: [String]
    let missingTokens: [String]
}

enum FidelityError: LocalizedError {
    case usage(String)
    case tooManyReferences

    var errorDescription: String? {
        switch self {
        case .usage(let message): return message
        case .tooManyReferences: return "at most \(maximumReferenceImages) reference images are allowed"
        }
    }
}

struct FidelityArguments {
    let compareText: Bool
    let candidate: String
    let requiredReference: String
    let references: [String]
}

func parseArguments(_ values: [String]) throws -> FidelityArguments {
    var compareText = false
    var candidate: String?
    var requiredReference: String?
    var references: [String] = []
    var index = 1
    while index < values.count {
        switch values[index] {
        case "--compare-text":
            compareText = true
            index += 1
        case "--candidate", "--required-reference", "--reference":
            let option = values[index]
            guard index + 1 < values.count, !values[index + 1].isEmpty else {
                throw FidelityError.usage("missing value for \(option)")
            }
            let value = values[index + 1]
            if option == "--candidate" {
                guard candidate == nil else { throw FidelityError.usage("--candidate may be specified only once") }
                candidate = value
            } else if option == "--required-reference" {
                guard requiredReference == nil else { throw FidelityError.usage("--required-reference may be specified only once") }
                requiredReference = value
            } else {
                references.append(value)
            }
            index += 2
        default:
            throw FidelityError.usage("unknown argument: \(values[index])")
        }
    }
    guard let candidate, let requiredReference else {
        throw FidelityError.usage("usage: image-label-fidelity [--compare-text] --candidate VALUE --required-reference VALUE [--reference VALUE ...]")
    }
    let allReferences = [requiredReference] + references
    var seen = Set<String>()
    let uniqueReferences = allReferences.filter { seen.insert($0).inserted }
    if uniqueReferences.count > maximumReferenceImages { throw FidelityError.tooManyReferences }
    return FidelityArguments(
        compareText: compareText,
        candidate: candidate,
        requiredReference: requiredReference,
        references: uniqueReferences
    )
}

func recognizedLines(at path: String) throws -> [String] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.recognitionLanguages = ["ko-KR", "en-US", "ja-JP", "zh-Hant"]
    request.minimumTextHeight = 0.010
    let barcodeRequest = VNDetectBarcodesRequest()
    let imageURL = URL(fileURLWithPath: path)
    try VNImageRequestHandler(url: imageURL, options: [:]).perform([request, barcodeRequest])
    let textLines = (request.results ?? []).compactMap { observation in
        observation.topCandidates(1).first?.string
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }.filter { !$0.isEmpty }
    var barcodePayloads = Set<String>((barcodeRequest.results ?? []).compactMap { observation -> String? in
        guard let payload = observation.payloadStringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
              payload.count >= 8 else { return nil }
        return payload
    })
    if let source = CIImage(contentsOf: imageURL) {
        for quarterTurns in 1...3 {
            let orientedRequest = VNDetectBarcodesRequest()
            let angle = CGFloat(quarterTurns) * .pi / 2
            let rotated = source.transformed(by: CGAffineTransform(rotationAngle: angle))
            let normalized = rotated.transformed(
                by: CGAffineTransform(translationX: -rotated.extent.minX, y: -rotated.extent.minY)
            )
            let handler = VNImageRequestHandler(ciImage: normalized, options: [:])
            guard (try? handler.perform([orientedRequest])) != nil else { continue }
            for observation in orientedRequest.results ?? [] {
                guard let payload = observation.payloadStringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
                      payload.count >= 8 else { continue }
                barcodePayloads.insert(payload)
            }
        }
    }
    return textLines + barcodePayloads.sorted()
}

func matches(_ pattern: String, in value: String) -> [String] {
    guard let regex = try? NSRegularExpression(pattern: pattern, options: []) else { return [] }
    let range = NSRange(value.startIndex..<value.endIndex, in: value)
    return regex.matches(in: value, range: range).compactMap { match in
        guard let tokenRange = Range(match.range, in: value) else { return nil }
        return String(value[tokenRange])
    }
}

func normalizedToken(_ value: String) -> String {
    value
        .precomposedStringWithCanonicalMapping
        .folding(options: [.widthInsensitive], locale: Locale(identifier: "en_US_POSIX"))
        .replacingOccurrences(of: "\\s", with: "", options: .regularExpression)
        .trimmingCharacters(in: .punctuationCharacters)
}

func protectedTokens(from lines: [String]) -> [String] {
    let joined = lines.joined(separator: "\n")
    let patterns = [
        #"(?i)(?<![\p{L}\p{N}])\d[\d,.]*(?:\s?(?:kcal|kg|mg|ml|tb|gb|mb|kb|cm|mm|oz|lb|g|l|m|%|정|개|캡슐|포|매))?(?![\p{L}\p{N}])"#,
        #"(?<![\p{L}\p{N}])\p{L}[\p{L}\p{N}&.'-]*(?![\p{L}\p{N}])"#,
    ]
    var seen = Set<String>()
    var tokens: [String] = []
    for pattern in patterns {
        for raw in matches(pattern, in: joined) {
            let token = normalizedToken(raw)
            guard token.count >= 1, token.count <= 160, !seen.contains(token) else { continue }
            seen.insert(token)
            tokens.append(token)
        }
    }
    return tokens
}

func fidelityReport(referenceLines: [String], requiredLines: [String], candidateLines: [String]) -> FidelityReport {
    let referenceTokens = protectedTokens(from: referenceLines)
    let requiredTokens = protectedTokens(from: requiredLines)
    let candidateTokens = protectedTokens(from: candidateLines)
    let referenceSet = Set(referenceTokens)
    let candidateSet = Set(candidateTokens)
    return FidelityReport(
        referenceLines: Array(referenceLines.prefix(maximumReferenceLines)),
        candidateLines: Array(candidateLines.prefix(maximumCandidateLines)),
        referenceTokens: referenceTokens,
        requiredTokens: requiredTokens,
        candidateTokens: candidateTokens,
        unsupportedTokens: candidateTokens.filter { !referenceSet.contains($0) },
        missingTokens: requiredTokens.filter { !candidateSet.contains($0) }
    )
}

func run() throws {
    let arguments = try parseArguments(CommandLine.arguments)
    let candidateLines: [String]
    let requiredLines: [String]
    var referenceLines: [String] = []
    if arguments.compareText {
        candidateLines = [arguments.candidate]
        requiredLines = [arguments.requiredReference]
        referenceLines = arguments.references
    } else {
        candidateLines = try recognizedLines(at: arguments.candidate)
        requiredLines = try recognizedLines(at: arguments.requiredReference)
        for path in arguments.references {
            referenceLines.append(contentsOf: try recognizedLines(at: path))
        }
    }
    let report = fidelityReport(
        referenceLines: referenceLines,
        requiredLines: requiredLines,
        candidateLines: candidateLines
    )
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    FileHandle.standardOutput.write(try encoder.encode(report))
    FileHandle.standardOutput.write(Data("\n".utf8))
}

do {
    try run()
} catch {
    FileHandle.standardError.write(Data("image-label-fidelity failed: \(error.localizedDescription)\n".utf8))
    exit(1)
}
