import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const androidRoot = path.join(projectRoot, 'android')
const nativeBuildRoot = path.join(tmpdir(), 'vyro-rental-android-build')
const nativeAndroidRoot = path.join(nativeBuildRoot, 'android')
const sdkRoot = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk')
const roles = ['landlord', 'caretaker', 'tenant']
const npmCli = process.env.npm_execpath

if (!existsSync(path.join(androidRoot, 'gradlew.bat')) && !existsSync(path.join(androidRoot, 'gradlew'))) {
  console.error('Android project is missing. Run npm run android:setup first.')
  process.exit(1)
}
if (!npmCli) {
  console.error('Could not locate npm. Run this script with npm run android:build.')
  process.exit(1)
}
if (!existsSync(path.join(sdkRoot, 'platform-tools'))) {
  console.error(`Android SDK was not found at ${sdkRoot}. Set ANDROID_SDK_ROOT before building.`)
  process.exit(1)
}
const nativeAssetsRoot = path.join(nativeBuildRoot, 'assets')
const androidEnv = {
  ...process.env,
  ANDROID_HOME: sdkRoot,
  ANDROID_SDK_ROOT: sdkRoot,
  VYRO_ANDROID_ASSETS_ROOT: nativeAssetsRoot,
}

function runNode(script, args, env = process.env) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Command failed: ${path.basename(script)} ${args.join(' ')}`)
}

function runGradle(tasks, env) {
  const wrapper = path.join(nativeAndroidRoot, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')
  const result = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/c', `gradlew.bat ${tasks.join(' ')}`], { cwd: nativeAndroidRoot, env, stdio: 'inherit' })
    : spawnSync(wrapper, tasks, { cwd: nativeAndroidRoot, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Gradle failed with exit code ${result.status}.`)
}

const capCli = path.join(projectRoot, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor')
const downloadsDir = path.join(projectRoot, 'public', 'downloads')
const androidPublicDir = path.join(projectRoot, '.android-public')
mkdirSync(downloadsDir, { recursive: true })

try {
  rmSync(nativeBuildRoot, { recursive: true, force: true })
  for (const role of roles) {
    console.log(`\nBuilding ${role} web app bundle...`)
    rmSync(androidPublicDir, { recursive: true, force: true })
    mkdirSync(androidPublicDir, { recursive: true })
    for (const entry of readdirSync(path.join(projectRoot, 'public'))) {
      if (entry !== 'downloads') cpSync(path.join(projectRoot, 'public', entry), path.join(androidPublicDir, entry), { recursive: true })
    }
    runNode(npmCli, ['run', 'build'], { ...androidEnv, VITE_NATIVE_APP_ROLE: role })
    runNode(capCli, ['sync', 'android'], androidEnv)

    const roleAssetDir = path.join(nativeAssetsRoot, role)
    rmSync(roleAssetDir, { recursive: true, force: true })
    const rolePublicDir = path.join(roleAssetDir, 'public')
    mkdirSync(rolePublicDir, { recursive: true })
    cpSync(path.join(projectRoot, 'dist'), rolePublicDir, { recursive: true })

    const obsoleteRoleAssets = path.join(androidRoot, 'app', 'src', role, 'assets', 'public')
    rmSync(obsoleteRoleAssets, { recursive: true, force: true })
  }

  rmSync(path.join(nativeAssetsRoot, 'main'), { recursive: true, force: true })
  mkdirSync(path.join(nativeAssetsRoot, 'main'), { recursive: true })
  const capacitorAssets = path.join(androidRoot, 'app', 'src', 'main', 'assets')
  for (const entry of readdirSync(capacitorAssets)) {
    if (entry !== 'public') cpSync(path.join(capacitorAssets, entry), path.join(nativeAssetsRoot, 'main', entry), { recursive: true })
  }

  cpSync(androidRoot, nativeAndroidRoot, {
    recursive: true,
    filter: source => {
      const relative = path.relative(androidRoot, source)
      const parts = relative.split(path.sep)
      return !parts.includes('build') && !parts.includes('.gradle')
        && relative !== 'local.properties'
        && !relative.startsWith(path.join('app', 'src', 'main', 'assets', 'public'))
    },
  })
  const capacitorAndroidSource = path.join(projectRoot, 'node_modules', '@capacitor', 'android')
  const capacitorAndroidTarget = path.join(nativeBuildRoot, 'node_modules', '@capacitor', 'android')
  cpSync(capacitorAndroidSource, capacitorAndroidTarget, {
    recursive: true,
    filter: source => !path.relative(capacitorAndroidSource, source).split(path.sep).includes('build'),
  })

  console.log('\nAssembling the three installable Android APKs...')
  runGradle(roles.map(role => `assemble${role[0].toUpperCase()}${role.slice(1)}Debug`), androidEnv)

  for (const role of roles) {
    const apkPath = path.join(nativeAndroidRoot, 'app', 'build', 'outputs', 'apk', role, 'debug', `app-${role}-debug.apk`)
    if (!existsSync(apkPath)) throw new Error(`Expected APK was not generated: ${apkPath}`)
    cpSync(apkPath, path.join(downloadsDir, `vyro-${role}-app.apk`))
    console.log(`Created public/downloads/vyro-${role}-app.apk`)
  }

  console.log('\nRestoring the standard website build...')
  runNode(npmCli, ['run', 'build'], androidEnv)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  rmSync(androidPublicDir, { recursive: true, force: true })
  rmSync(nativeBuildRoot, { recursive: true, force: true })
}
