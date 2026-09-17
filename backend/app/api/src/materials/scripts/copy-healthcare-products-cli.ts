/**
 * CLI script for previewing and copying Healthcare Ontario products to Calgary warehouse.
 *
 * Usage:
 *   node dist/materials/scripts/copy-healthcare-products-cli.js [--source=UUID --target=UUID] [--execute]
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { HealthcareProductCopyService, ONTARIO_WAREHOUSE_ID, CALGARY_WAREHOUSE_ID } from '../healthcare-product-copy.service';

async function bootstrap() {
  const source = process.argv.find(a => a.startsWith('--source='))?.slice(9);
  const target = process.argv.find(a => a.startsWith('--target='))?.slice(9);
  const isExecute = process.argv.includes('--execute');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const copyService = app.get(HealthcareProductCopyService);

  console.log(`\n======================================================`);
  console.log(` HEALTHCARE PRODUCT COPY: ONTARIO -> CALGARY`);
  console.log(` Source Warehouse: Ontario (${source || 'resolve unambiguous warehouse'})`);
  console.log(` Target Warehouse: Calgary (${target || 'resolve unambiguous warehouse'})`);
  console.log(` Mode: ${isExecute ? 'EXECUTE' : 'PREVIEW ONLY'}`);
  console.log(`======================================================\n`);

  if (!isExecute) {
    const preview = await copyService.preview(source, target);
    console.log(`Evaluated ${preview.items.length} products:`);
    console.table(
      preview.items.map((i) => ({
        Product: i.productName,
        Unit: i.unit,
        Price: i.defaultPrice,
        'Ontario State': i.ontarioState,
        'Calgary State': i.calgaryState,
        Action: i.actionNeeded,
      })),
    );
    console.log(`\nSummary:`);
    console.log(`  Total Evaluated:   ${preview.summary.totalEvaluated}`);
    console.log(`  Already Present:   ${preview.summary.alreadyPresent}`);
    console.log(`  To Create:         ${preview.summary.toCreate}`);
    console.log(`  Skipped Inactive:  ${preview.summary.skippedInactive}`);
    console.log(`  Conflicts:         ${preview.summary.conflicts}`);
    console.log(`\nTo execute this copy, run with the --execute flag.`);
  } else {
    const result = await copyService.execute(source, target);
    console.log(`Copy execution finished at ${result.timestamp}:`);
    console.log(`  Created ${result.createdCount} products in Calgary warehouse.`);
    for (const p of result.createdProducts) {
      console.log(`    + Created: ${p.name} (ID: ${p.id})`);
    }
  }

  await app.close();
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error('Failed to run copy script:', err);
    process.exit(1);
  });
}
