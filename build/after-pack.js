'use strict';
// Pasang ikon & info versi ke BacaLayar.exe tanpa butuh Wine/rcedit (bisa build dari Linux).
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const { NtExecutable, NtExecutableResource, Resource, Data } = await import('resedit');
  const info = context.packager.appInfo;
  const exe = path.join(context.appOutDir, `${info.productFilename}.exe`);
  const ne = NtExecutable.from(fs.readFileSync(exe));
  const res = NtExecutableResource.from(ne);

  const iconFile = Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  const groups = Resource.IconGroupEntry.fromEntries(res.entries);
  const id = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  Resource.IconGroupEntry.replaceIconsForResource(res.entries, id, lang, iconFile.icons.map((i) => i.data));

  const vi = Resource.VersionInfo.fromEntries(res.entries)[0] || Resource.VersionInfo.createEmpty();
  const [a, b, c] = info.version.split('.').map((n) => parseInt(n, 10) || 0);
  vi.setFileVersion(a, b, c, 0, 1033);
  vi.setProductVersion(a, b, c, 0, 1033);
  const strings = {
    ProductName: info.productName,
    FileDescription: info.productName,
    CompanyName: 'Hendrayana',
    LegalCopyright: `© ${new Date().getFullYear()} Hendrayana`,
    OriginalFilename: `${info.productFilename}.exe`,
    InternalName: info.productFilename,
    FileVersion: info.version,
    ProductVersion: info.version,
  };
  const langs = vi.getAllLanguagesForStringValues();
  for (const l of langs.length ? langs : [{ lang: 1033, codepage: 1200 }]) vi.setStringValues(l, strings);
  vi.outputToResourceEntries(res.entries);

  res.outputResource(ne);
  fs.writeFileSync(exe, Buffer.from(ne.generate()));
  console.log('  • ikon & versi dipasang ke', path.basename(exe));

  // Modul native koffi untuk Windows x64: taruh juga sebagai paket npm biasa
  // (lokasi pertama yang dicari koffi), selain di resources/koffi.
  const src = path.join(__dirname, '..', 'vendor', 'koffi-win32-x64');
  const dst = path.join(context.appOutDir, 'resources', 'app', 'node_modules', '@koromix', 'koffi-win32-x64');
  fs.cpSync(src, dst, { recursive: true });
  console.log('  • koffi win32-x64 disalin');
};
