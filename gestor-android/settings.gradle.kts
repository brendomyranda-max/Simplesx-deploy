/**
 * Arquivo: settings.gradle.kts
 * Responsabilidade: Define módulos e repositórios usados pelo projeto Android.
 */

pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "SimplexsaGestorAndroid"
include(":app")
