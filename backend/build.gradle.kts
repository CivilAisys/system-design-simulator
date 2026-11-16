subprojects {
    group = "simulator"
    version = "0.4.1"

    plugins.withType<JavaPlugin> {
        extensions.configure<JavaPluginExtension> {
            toolchain.languageVersion = JavaLanguageVersion.of(21)
        }
        tasks.withType<Test>().configureEach {
            useJUnitPlatform()
        }
    }
}
