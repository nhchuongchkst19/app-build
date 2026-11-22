import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionDispatch } from '../src/session-config.mjs';

test('mobile sessions keep the Expo workflow and inputs', () => {
  const result = sessionDispatch({ platform: 'ios', profile: 'release', 'app-id': 'com.example.app' }, 'owner', 'app', 'session');
  assert.equal(result.workflow, 'expo-agent-session.yml');
  assert.deepEqual(result.inputs, {
    repo: 'app', owner: 'owner', branch: 'main', platform: 'ios', session_id: 'session',
    prepare_app: 'true', max_minutes: '120', idle_minutes: '15', profile: 'release',
    app_id: 'com.example.app', api_level: '35',
  });
});

test('desktop sessions select the desktop workflow and adapter', () => {
  const result = sessionDispatch({ platform: 'windows', framework: 'tauri', 'project-path': 'apps/desktop',
    ref: 'abc123', 'no-prepare': true }, 'owner', 'app', 'session');
  assert.equal(result.workflow, 'desktop-agent-session.yml');
  assert.deepEqual(result.inputs, {
    repo: 'app', owner: 'owner', branch: 'abc123', platform: 'windows', session_id: 'session',
    prepare_app: 'false', max_minutes: '120', idle_minutes: '15', framework: 'tauri',
    project_path: 'apps/desktop',
  });
});

test('native sessions select dedicated mobile and desktop workflows', () => {
  const android = sessionDispatch({ platform: 'android', framework: 'native', 'app-id': 'com.example.native',
    'project-path': 'android' }, 'owner', 'app', 'session');
  assert.equal(android.workflow, 'native-mobile-agent-session.yml');
  assert.equal(android.inputs.project_path, 'android');
  assert.equal(android.inputs.app_id, 'com.example.native');

  const windows = sessionDispatch({ platform: 'windows', framework: 'native', toolchain: 'winui3',
    'project-path': 'windows' }, 'owner', 'app', 'session');
  assert.equal(windows.workflow, 'native-desktop-agent-session.yml');
  assert.equal(windows.inputs.toolchain, 'winui3');
  assert.equal(windows.inputs.project_path, 'windows');
});

test('desktop session inputs reject unsupported frameworks and unsafe paths', () => {
  assert.throws(() => sessionDispatch({ platform: 'macos', framework: 'flutter' }, 'owner', 'app', 'session'), /framework/);
  assert.throws(() => sessionDispatch({ platform: 'windows', framework: 'native', toolchain: 'qt' }, 'owner', 'app', 'session'), /toolchain/);
  assert.throws(() => sessionDispatch({ platform: 'windows', 'project-path': '../private' }, 'owner', 'app', 'session'), /project-path/);
  assert.throws(() => sessionDispatch({ platform: 'linux' }, 'owner', 'app', 'session'), /platform/);
});
