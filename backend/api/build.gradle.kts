plugins {
    java
    alias(libs.plugins.spring.boot)
}

repositories {
    mavenCentral()
}

dependencies {
    implementation(platform(org.springframework.boot.gradle.plugin.SpringBootPlugin.BOM_COORDINATES))
    implementation(project(":engine"))
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation(libs.springdoc.webmvc)

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

val openApiFile = layout.projectDirectory.file("openapi.json")
// 前端內建範例，/simulate 整合測試直接讀同一份檔案（spec 第 7 節）
val basicWebAppExample = rootProject.layout.projectDirectory.file("../frontend/src/examples/basic-web-app.json")

tasks.test {
    inputs.file(openApiFile).withPropertyName("openApiFile")
    systemProperty("openapi.file", openApiFile.asFile.absolutePath)
    inputs.file(basicWebAppExample).withPropertyName("basicWebAppExample")
    systemProperty("example.basic-web-app", basicWebAppExample.asFile.absolutePath)
}

// 重新產生 openapi.json：跑同一個同步測試，但改成寫檔而不是比對
tasks.register<Test>("generateOpenApi") {
    description = "Regenerates openapi.json from the current code."
    group = "documentation"
    testClassesDirs = sourceSets.test.get().output.classesDirs
    classpath = sourceSets.test.get().runtimeClasspath
    filter { includeTestsMatching("*OpenApiSyncTest") }
    systemProperty("openapi.file", openApiFile.asFile.absolutePath)
    systemProperty("openapi.update", "true")
    outputs.upToDateWhen { false }
}
