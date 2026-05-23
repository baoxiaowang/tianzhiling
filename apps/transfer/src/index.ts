import { closeTransferConnections, createTransferContext } from './runtime';

async function main(): Promise<void> {
  const context = await createTransferContext();

  try {
    context.logger.info('transfer app is ready');
  } finally {
    await closeTransferConnections(context);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
