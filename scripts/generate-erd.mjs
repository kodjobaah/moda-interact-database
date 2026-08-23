import {
  readFile,
  writeFile,
  unlink,
  mkdir,
} from "node:fs/promises";

import {
  execFileSync,
} from "node:child_process";


const sourceSchema =
  "prisma/schema.prisma";

const temporarySchema =
  "prisma/schema.erd.prisma";

const outputDirectory =
  "docs/generated";


await mkdir(
  outputDirectory,
  {
    recursive: true,
  },
);


const schema =
  await readFile(
    sourceSchema,
    "utf8",
  );


/*
 * Remove existing Prisma generators.
 *
 * We don't want the temporary ERD schema to generate
 * @prisma/client as well.
 */
const schemaWithoutGenerators =
  schema.replace(
    /generator\s+\w+\s*\{[\s\S]*?\}/g,
    "",
  );


const plantUmlGenerator = `
generator plantuml {
  provider = "prisma-generator-plantuml-erd"
  output   = "../docs/generated/prisma-erd.puml"
}
`;


const erdSchema = `
${plantUmlGenerator}

${schemaWithoutGenerators}
`;


await writeFile(
  temporarySchema,
  erdSchema,
);


try {
  execFileSync(
    "npx",
    [
      "prisma",
      "generate",
      "--schema",
      temporarySchema,
    ],
    {
      stdio: "inherit",
    },
  );
} finally {
  await unlink(
    temporarySchema,
  ).catch(() => {});
}


console.log(
  "\nPlantUML ERD generated at docs/generated/prisma-erd.puml",
);
