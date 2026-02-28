import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Deleting existing PaymentQR data...');
  
  await prisma.paymentQR.deleteMany({});
  
  console.log('Creating new PaymentQR data...');

  // Create eSewa QR
  await prisma.paymentQR.create({
    data: {
      method: 'esewa',
      qrImage: 'https://via.placeholder.com/400x400.png/60A917/FFFFFF?text=eSewa+QR+Code',
      accountName: 'CrackZones Gaming',
      accountNumber: '9876543210',
      isActive: true,
    },
  });

  // Create Khalti QR
  await prisma.paymentQR.create({
    data: {
      method: 'khalti',
      qrImage: 'https://via.placeholder.com/400x400.png/5D2E8C/FFFFFF?text=Khalti+QR+Code',
      accountName: 'CrackZones Gaming',
      accountNumber: '9876543210',
      isActive: true,
    },
  });

  console.log('PaymentQR data reset successfully!');
  console.log('eSewa QR: https://via.placeholder.com/400x400.png/60A917/FFFFFF?text=eSewa+QR+Code');
  console.log('Khalti QR: https://via.placeholder.com/400x400.png/5D2E8C/FFFFFF?text=Khalti+QR+Code');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
