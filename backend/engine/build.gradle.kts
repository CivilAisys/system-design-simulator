plugins {
    `java-library`
}

repositories {
    mavenCentral()
}

dependencies {
    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testImplementation(libs.assertj)
    testRuntimeOnly(libs.junit.launcher)
}

// engine 是純 Java：任何 Spring 依賴（包含遞移依賴）都讓建置失敗
configurations.configureEach {
    resolutionStrategy.eachDependency {
        if (requested.group.startsWith("org.springframework")) {
            throw GradleException("engine must not depend on Spring: ${requested.group}:${requested.name}")
        }
    }
}
