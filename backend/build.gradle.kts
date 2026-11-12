subprojects {
    group = "simulator"
    version = "0.1.0-SNAPSHOT"

    plugins.withType<JavaPlugin> {
        extensions.configure<JavaPluginExtension> {
            toolchain.languageVersion = JavaLanguageVersion.of(21)
        }
        tasks.withType<Test>().configureEach {
            useJUnitPlatform()
        }
    }
}
