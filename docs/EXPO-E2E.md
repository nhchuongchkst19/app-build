# Build và test Expo trên GitHub Actions

Workflow mới: `.github/workflows/expo-e2e.yml`. Không thay `build.yml`, không
submit Store, gửi Telegram, dùng BrowserStack hoặc tải signing credentials.
Workflow chỉ chạy thủ công bởi người có quyền GitHub và có shared key hiện tại.

## Ba chế độ

| mode | Hành vi |
| --- | --- |
| `build` | Compile APK x86_64 / iOS Simulator Release, nhúng JS, upload binary |
| `build-test` | Build và upload binary trước, sau đó chạy Maestro |
| `test` | Tải binary của `binary_run`, chạy script tại `test_ref`, không install dependencies hoặc compile app |

Cả hai binary là bản test cho máy ảo, không dùng phát hành. Không cần Metro
hoặc đăng nhập Expo/Apple. Với Android, template Expo thường ký Release bằng
khóa debug; dự án cấu hình production signing phải tự cung cấp cấu hình ký
chỉ dành cho emulator. Workflow kiểm APK có chữ ký, không lấy khóa Store.

`repo` là tên repo thuộc owner trong secret `USER`; dùng lại `KEY`, `GH_TOKEN`
của builder. App ở root repo, dùng đúng một lockfile pnpm/npm/Yarn.
Dùng Node 24, Java 17, runner Ubuntu/`macos-26`, Android API 35 x86_64.
Các dự án cần biến môi trường riêng phải thêm cấu hình giới hạn cho app đó;
workflow không kế thừa `env` từ profile trong `eas.json`.

`branch` chọn source app; khuyến nghị SHA đầy đủ. `test_ref` chọn riêng source
script, mặc định bằng `branch`. `flow_path` mặc định `.maestro` và phải nằm
trong checkout test. `app_id` phải khớp binary. `ios_scheme` tùy chọn khi có
nhiều shared scheme. Với dự án có native folders, dùng nguyên các folder đã
commit; với CNG, chạy `expo prebuild --no-install` nếu chưa có folder tương ứng.
Hook `eas-build-post-install` của app được chạy sau install dependencies.
Nếu có Gemfile, chạy `bundle install` trước `bundle exec pod`.
Chưa hỗ trợ monorepo, Android product flavors hoặc hook EAS khác.

## Vòng sửa lỗi

1. Chạy `mode=build-test` cho app, ví dụ `repo=session-box-app`,
   `app_id=com.sessionbox`; tên repo phải là tên GitHub thực tế, không phải tên folder local.
2. Nếu script sai, sửa/commit script rồi chạy `mode=test`,
   `binary_run=<run ban đầu>`, `test_ref=<SHA script mới>`.
3. Có thể dùng binary từ run test thất bại: binary đã upload trước bước UI test.
   Run nguồn phải hoàn tất và có artifact `expo-e2e-android`/`expo-e2e-ios`.
   Run chỉ-test không tạo binary mới; tiếp tục trỏ về run đã build.
4. Nếu sửa Kotlin/Swift hoặc JS nhúng trong binary, chạy lại `build-test` với
   source mới. Phần compile không đổi có thể lấy từ cache nếu builder private.

Workflow xác minh repo/platform/app ID/run ID và checksum SHA-256 khi tái sử dụng.
Manifest ghi source SHA của binary; report ghi SHA script riêng để tránh
nhầm test script mới với app đã được build từ source mới.

## Script mẫu cho Session Spaces

Đặt trong repo app tại `.maestro/smoke.yaml` (APP_ID được workflow truyền vào):

```yaml
appId: ${APP_ID}
---
- launchApp:
    clearState: true
- extendedWaitUntil:
    visible: Sessions
    timeout: 60000
- tapOn:
    id: open-settings
- assertVisible:
    id: screen-settings
- assertVisible:
    id: settings-privacy
```

Đây là smoke test UI, không phải nghiệm thu cookie/profile/restore. Test WebView
cần fixture có dữ liệu giả và assertions riêng. Không dùng tài khoản/cookie/token
thật trong flow, screenshot, cache hoặc log. Mỗi run dùng máy ảo mới, không giữ
phiên đăng nhập; thêm `clearState` khi cần cô lập các flow trong cùng run.

## Cache và tốc độ

Builder hiện public: theo chính sách repo, tắt cache chứa private dependencies,
Pods, Gradle outputs và Xcode DerivedData. Không tự đổi visibility của repo.
Nếu chuyển builder sang private, cache native tự bật: Gradle user home,
Android build outputs, Pods và DerivedData; khóa cache tách theo app/platform,
runner/toolchain và lockfile/config, có fallback về lần build tương thích trước.
Chỉ cache không gian build, không cache simulator/app data hoặc credentials.

Cache không giữ máy ảo đang chạy, và không đảm bảo lần sửa native nào cũng nhanh.
Không chạy `clean` mặc định. Xcode/Gradle quyết định phần nào phải compile lại;
đổi toolchain/dependencies có thể cần build rộng hơn. Lần đầu chưa có cache.
Chưa có chế độ Metro hoặc self-hosted runner; JS sửa trong workflow này vẫn
cần build lại. Có thể bổ sung sau khi đo thời gian thực tế.

## Artifacts và vòng đời

Binary và kết quả test giữ 14 ngày (còn chịu giới hạn retention của GitHub).
Job cleanup giữ các run `expo-e2e.yml` trong 14 ngày; workflow cũ vẫn theo
chính sách xóa ngay sau khi hoàn tất. Các run đang chạy không bị cleanup xóa.

Kết quả gồm JUnit, Maestro debug artifacts/log, ảnh cuối màn hình và Android
logcat. Artifacts của repo public có thể được người có quyền đọc repo tải về;
chỉ dùng build và dữ liệu test được phép chia sẻ. Không mặc định ghi video.
Nếu artifact hết hạn/bị xóa, phải build lại. Test-only không cần cache build.

## Kiểm chứng

Kiểm tra YAML/actionlint, syntax helper và các guard metadata trước khi chạy CI.
Chỉ coi emulator/simulator đã hoạt động sau khi có run thực tế với app tương ứng.
Nguồn: [Maestro reports](https://docs.maestro.dev/maestro-flows/workspace-management/test-reports-and-artifacts),
[Android emulator action](https://github.com/ReactiveCircus/android-emulator-runner),
[Xcode incremental build](https://developer.apple.com/documentation/xcode/improving-the-speed-of-incremental-builds).
