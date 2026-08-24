const fs = require('fs');
let code = fs.readFileSync('src/lib/apartment-score/server/calculate.ts', 'utf8');

code = code.replace(
  "import { classifyPreparingReason } from './preparing-reason';",
  "import { classifyPreparingReason } from './preparing-reason';\nimport { calculateScoreV2 } from '../../score-v2/engine';\nimport { adaptToV2Input } from '../../score-v2/adapter';"
);

code = code.replace(
  "if (coverage < MIN_TOTAL_COVERAGE || scoredCategories.length === 0) {",
  `let shadowV2Result: any = null;\n  try {\n    const v2Input = adaptToV2Input(masterByAptSeq.get(targetMaster.aptSeq)!, locationByAptSeq.get(targetMaster.aptSeq) ?? null);\n    shadowV2Result = calculateScoreV2(v2Input, 2026);\n  } catch (err) {\n    console.error('[ScoreV2 Shadow Error]', err);\n  }\n\n  if (coverage < MIN_TOTAL_COVERAGE || scoredCategories.length === 0) {`
);

code = code.replace(
  /preparingReason: classifyPreparingReason\(categories\),\n    };/g,
  "preparingReason: classifyPreparingReason(categories),\n      _shadowV2: shadowV2Result,\n    };"
);

code = code.replace(
  /preparingReason: null,\n  };/g,
  "preparingReason: null,\n    _shadowV2: shadowV2Result,\n  };"
);

fs.writeFileSync('src/lib/apartment-score/server/calculate.ts', code);
console.log('patched');
