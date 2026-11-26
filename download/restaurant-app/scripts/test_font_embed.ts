import fs from 'fs';
async function main() {
  const pdfLib = await import('pdf-lib');
  const { PDFDocument, StandardFonts } = pdfLib;
  const doc = await PDFDocument.create();
  try {
    const reg = fs.readFileSync('public/fonts/DejaVuSans.ttf');
    const f = await doc.embedFont(reg, { subset: true });
    const page = doc.addPage([420, 300]);
    page.drawText('₹210.00 ✓', { x: 30, y: 200, size: 12, font: f });
    const bytes = await doc.save();
    fs.writeFileSync('/tmp/inv_standalone.pdf', bytes);
    console.log('standalone OK, size:', bytes.length);
  } catch (e) {
    console.log('EMBED FAIL:', (e as Error).message);
  }
}
main();
