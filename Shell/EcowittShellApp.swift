import SwiftUI

@main
struct EcowittShellApp: App {
    var body: some Scene {
        WindowGroup {
            VStack(spacing: 12) {
                Text("Ecowitt Widget Shell").font(.title3.bold())
                Text("这个壳只用于产出 .appex，没有实际功能。")
                    .font(.footnote)
                    .foregroundColor(.secondary)
            }
            .padding()
        }
    }
}
