import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Creating admin user...');

  const email = 'admin@crackzones.com';
  const password = 'admin123';
  const hashedPassword = await bcrypt.hash(password, 10);

  // Check if admin already exists
  const existingAdmin = await prisma.user.findUnique({
    where: { email },
  });

  if (existingAdmin) {
    console.log('Admin user already exists!');
    console.log('Email:', email);
    console.log('Password: admin123');
    return;
  }

  // Create admin user
  const admin = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      name: 'Admin User',
      isVerified: true,
      walletBalance: 0,
    },
  });

  console.log('✅ Admin user created successfully!');
  console.log('');
  console.log('Login Credentials:');
  console.log('==================');
  console.log('Email:', email);
  console.log('Password: admin123');
  console.log('');
  console.log('Use these credentials to login to the admin panel at http://localhost:3000');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
