import Foundation
import Vision
import AppKit

// Usage: swift ocr.swift <image1> [image2 ...]
let args = Array(CommandLine.arguments.dropFirst())
guard !args.isEmpty else {
    FileHandle.standardError.write("No images provided\n".data(using: .utf8)!)
    exit(1)
}

for path in args {
    guard let img = NSImage(contentsOfFile: path),
          let tiff = img.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiff),
          let cg = bitmap.cgImage else {
        print("=== \(path) ===")
        print("[could not load image]")
        print("")
        continue
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["pl-PL", "en-US"]

    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    do {
        try handler.perform([request])
    } catch {
        print("=== \(path) ===")
        print("[OCR error: \(error)]")
        print("")
        continue
    }

    let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    print("=== \((path as NSString).lastPathComponent) ===")
    print(lines.joined(separator: "\n"))
    print("")
}
