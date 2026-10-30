import fs from 'node:fs/promises';
import path from 'node:path';

export async function normalizeLoadlyRequest(params, workspace, platform) {
  if (!['android', 'ios'].includes(platform)) throw Error('Loadly requires an Android or iOS session');
  const profile = params.profile ?? 'development';
  if (typeof profile !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(profile)) throw Error('Invalid EAS profile');
  const title = params.title ?? '';
  if (typeof title !== 'string' || title.length > 200 || /[\r\n\0]/.test(title)) throw Error('Invalid release title');
  let artifactPath = null;
  if (params.path !== undefined && params.path !== null) {
    if (typeof params.path !== 'string' || !params.path.length || /[\r\n\0]/.test(params.path)) throw Error('Invalid artifact path');
    const root = await fs.realpath(workspace);
    artifactPath = await fs.realpath(path.resolve(root, params.path));
    if (!artifactPath.startsWith(root + path.sep)) throw Error('Loadly artifact must be inside the session workspace');
    if (path.extname(artifactPath).toLowerCase() !== (platform === 'android' ? '.apk' : '.ipa')) {
      throw Error('Loadly requires an Android APK or a signed device IPA; simulator archives and AABs are not supported');
    }
    if (!(await fs.stat(artifactPath)).isFile()) throw Error('Artifact must be a file');
  }
  return { schema: 1, destination: 'loadly', platform, profile, title, artifactPath };
}
