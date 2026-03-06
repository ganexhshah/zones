import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_SEED_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_SEED_PASSWORD ?? '';
  const name = process.env.ADMIN_SEED_NAME?.trim() || 'Admin User';

  if (!email || !password) {
    throw new Error('ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD are required');
  }
  if (password.length < 12) {
    throw new Error('ADMIN_SEED_PASSWORD must be at least 12 characters');
  }

  console.log(`Seeding admin user for ${email}...`);
  const hashedPassword = await bcrypt.hash(password, 10);

  const existingAdmin = await prisma.user.findUnique({
    where: { email },
  });

  if (existingAdmin) {
    console.log(`Admin user already exists for ${email}`);
    return;
  }

  await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      passwordHash: hashedPassword,
      name,
      isVerified: true,
      walletBalance: 0,
    },
  });

  console.log(`Admin user created for ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
