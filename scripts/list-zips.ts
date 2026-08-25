import AdmZip from 'adm-zip';

function listZip(zipPath: string) {
  try {
    const zip = new AdmZip(zipPath);
    console.log(zipPath, "contains:");
    zip.getEntries().forEach(entry => {
      console.log(entry.entryName);
    });
  } catch (e) {
    console.error(e);
  }
}

listZip('D:\\다운로드\\국토교통부_건축물대장_표제부+(2026년+07월).zip');
listZip('D:\\다운로드\\국토교통부_건축물대장_전유부+(2026년+07월).zip');
listZip('D:\\다운로드\\국토교통부_건축물대장_전유공용면적+(2026년+07월).zip');
