import fs from 'fs';
import readline from 'readline';

async function filterFile(inputPath: string, outputPath: string) {
  console.log(`Filtering ${inputPath} to ${outputPath}...`);
  const readStream = fs.createReadStream(inputPath, { encoding: 'utf8' });
  const writeStream = fs.createWriteStream(outputPath);
  
  const rl = readline.createInterface({
    input: readStream,
    crlfDelay: Infinity
  });

  let count = 0;
  for await (const line of rl) {
    if (line.includes('|26140|')) {
      writeStream.write(line + '\n');
      count++;
    }
  }

  writeStream.end();
  console.log(`Done filtering. Seo-gu rows: ${count}`);
}

async function run() {
  await filterFile('tmp/building-registry-202607/title/mart_djy_03.txt', 'tmp/building-registry-202607/seo-gu-title.txt');
  await filterFile('tmp/building-registry-202607/unit/mart_djy_09.txt', 'tmp/building-registry-202607/seo-gu-unit.txt');
  await filterFile('tmp/building-registry-202607/common/mart_djy_06.txt', 'tmp/building-registry-202607/seo-gu-common.txt');
}

run().catch(console.error);
