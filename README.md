# Baca Layar

Aplikasi Windows untuk **membaca teks langsung dari layar** — modul PDF, halaman web, slide, atau aplikasi apa pun — tanpa membuka filenya dan tanpa ekstensi browser. Teks dikenali dengan OCR, dirapikan, lalu dibacakan dengan suara Windows. Ada juga **gulir mouse otomatis** dan **rekam layar**.

## Fitur

- **Buka halaman di aplikasi** (`Ctrl+Alt+H`) — browser bawaan di jendela Baca Layar sendiri: buka modul UT / halaman web, lalu **Baca halaman**, **Pilih area**, atau **Baca Terus** langsung dari dalam — tanpa screenshot layar, tanpa menggerakkan mouse, dan tetap jalan walau jendela tertutup aplikasi lain. Tombol **Teks halaman** mengambil teks artikel biasa tanpa OCR. Login situs tersimpan.
- **Pilih area & baca** (`Ctrl+Alt+O`) — seret kotak di atas tulisan; teks muncul dan langsung dibacakan.
- **Baca ulang area** (`Ctrl+Alt+L`) — setelah ganti halaman, baca lagi area yang sama.
- **Baca Terus** (`Ctrl+Alt+B`) — baca area → bacakan → gulir ke bawah sendiri → lanjut, sampai akhir dokumen. Kalimat yang sudah dibaca tidak diulang.
- **Kumpulkan screenshot** (`Ctrl+Alt+S`) — tanpa OCR: potret area → simpan PNG → gulir otomatis → potret lagi, sampai akhir dokumen. Tersimpan berurutan (001.png, 002.png, …) di `Pictures\Baca Layar\Tangkapan <tanggal>` untuk dibaca/di-OCR belakangan. Berhenti sendiri bila tampilan tidak berubah lagi.
- **Gulir mouse**: `Ctrl+Alt+PageDown` / `Ctrl+Alt+PageUp` di posisi mouse, dan **gulir otomatis** (`Ctrl+Alt+G`) dengan kecepatan yang bisa diatur.
- **Tunggu halaman tampil** — kalau area masih putih (halaman sedang memuat / PDF belum digambar), aplikasi menunggu sampai tulisan muncul (maks. 15 detik) sebelum membaca.
- **Pembersih watermark** — watermark tipis (mis. NIM di modul UT) tidak ikut terbaca.
- **Rapikan teks** — baris digabung jadi paragraf, daftar bernomor tetap per baris, huruf hiasan besar di awal paragraf diperbaiki.
- **Suara Windows** termasuk suara Bahasa Indonesia *Microsoft Andika*, kecepatan bisa diatur, bisa jeda/lanjut.
- **Rekam layar** (`Ctrl+Alt+R`) — seluruh layar atau satu jendela, dengan suara komputer dan/atau mikrofon, disimpan sebagai MP4 di `Videos\Baca Layar`.
- Berjalan di **tray**; semua hotkey tetap aktif saat jendela tersembunyi. `Ctrl+Alt+X` menghentikan suara, Baca Terus, dan gulir.
- **Update otomatis** dari GitHub Releases — diperiksa saat aplikasi dibuka dan tiap 6 jam. Bisa juga manual: tombol **Update** di pojok kanan atas, tab **Atur → Update**, atau menu tray **Cek update**.

## Pasang

Unduh `BacaLayar-Setup-x.y.z.exe` dari halaman **Releases**, jalankan. Karena installer belum ditandatangani, Windows SmartScreen mungkin muncul: klik **Info selengkapnya → Tetap jalankan**.

Suara Bahasa Indonesia: **Pengaturan Windows → Waktu & bahasa → Ucapan → Tambahkan suara → Bahasa Indonesia**, lalu buka ulang Baca Layar.

## Tips Baca Terus

- Pilih area **hanya kolom teks** (tanpa toolbar/menu) agar hasil paling bersih.
- Ada kalimat terlewat → kecilkan *jarak gulir* di tab **Gulir**. Banyak kalimat diulang → besarkan.
- Halaman lambat memuat → naikkan *tunggu setelah gulir*.

## Versi Linux (hanya kumpulkan screenshot)

`BacaLayar-x.y.z-linux-x64.AppImage` (atau `.deb`) berisi fitur **Kumpulkan screenshot** saja: pilih area → potret → gulir otomatis → potret lagi. Butuh `xdotool` untuk gulir (`sudo apt install xdotool`); di Wayland pakai `ydotool`. AppImage: `chmod +x` lalu jalankan. Build: `npm run dist:linux`.

## Pengembangan

```bash
npm install
npm start          # jalankan aplikasi
npm test           # uji perapian teks & logika gulir
npm run dist       # buat installer Windows (dist/)
```

Rilis baru: naikkan `version` di `package.json` lalu push ke `main` — GitHub Actions membuat installer dan rilisnya, dan aplikasi yang sudah terpasang akan memperbarui diri.

Teknologi: Electron, [Tesseract.js](https://github.com/naptha/tesseract.js) (OCR offline, data bahasa Indonesia + Inggris disertakan), Windows.Media.Ocr dan Windows.Media.SpeechSynthesis lewat PowerShell, [koffi](https://koffi.dev) untuk gulir mouse via `user32.dll`.

Lisensi MIT.
