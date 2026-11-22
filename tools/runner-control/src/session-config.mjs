const MOBILE_PLATFORMS = new Set(['android', 'ios']);
const DESKTOP_PLATFORMS = new Set(['windows', 'macos']);

export function sessionDispatch(options, owner, repo, sessionId) {
  const platform = options.platform || 'android';
  if (!MOBILE_PLATFORMS.has(platform) && !DESKTOP_PLATFORMS.has(platform)) {
    throw Error('--platform must be android, ios, windows, or macos');
  }
  const common = {
    repo,
    owner,
    branch: options.ref || 'main',
    platform,
    session_id: sessionId,
    prepare_app: options['no-prepare'] ? 'false' : 'true',
    max_minutes: options['max-minutes'] || '120',
    idle_minutes: options['idle-minutes'] || '15',
  };
  const projectPath = options['project-path'] || '.';
  if (projectPath.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(projectPath) || !/^[A-Za-z0-9._/-]+$/.test(projectPath)) {
    throw Error('--project-path must be a safe relative path');
  }
  if (DESKTOP_PLATFORMS.has(platform)) {
    const framework = options.framework || 'electron';
    if (!['electron', 'tauri', 'native'].includes(framework)) throw Error('--framework must be electron, tauri, or native');
    if (framework === 'native') {
      const toolchain = options.toolchain || 'auto';
      if (!['auto', 'winui3', 'dotnet', 'msbuild', 'xcode', 'swiftpm', 'cmake'].includes(toolchain)) {
        throw Error('--toolchain must be auto, winui3, dotnet, msbuild, xcode, swiftpm, or cmake');
      }
      return {
        platform,
        workflow: 'native-desktop-agent-session.yml',
        inputs: { ...common, project_path: projectPath, toolchain },
      };
    }
    return {
      platform,
      workflow: 'desktop-agent-session.yml',
      inputs: { ...common, framework, project_path: projectPath },
    };
  }
  const framework = options.framework || 'expo';
  if (!['expo', 'native'].includes(framework)) throw Error('--framework must be expo or native for Android/iOS');
  if (framework === 'native') {
    return {
      platform,
      workflow: 'native-mobile-agent-session.yml',
      inputs: { ...common, app_id: options['app-id'] || '', project_path: projectPath },
    };
  }
  return {
    platform,
    workflow: 'expo-agent-session.yml',
    inputs: {
      ...common,
      profile: options.profile || 'development',
      app_id: options['app-id'] || '',
      api_level: options['api-level'] || '35',
    },
  };
}
