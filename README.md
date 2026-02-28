# Zones Backend API

Next.js backend API for the Zones gaming platform.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables:
Create a `.env` file with:
```
DATABASE_URL="your_database_url"
JWT_SECRET="your_jwt_secret"
CLOUDINARY_CLOUD_NAME="your_cloudinary_name"
CLOUDINARY_API_KEY="your_cloudinary_key"
CLOUDINARY_API_SECRET="your_cloudinary_secret"
RAZORPAY_KEY_ID="your_razorpay_key"
RAZORPAY_KEY_SECRET="your_razorpay_secret"
```

3. Run database migrations:
```bash
npx prisma migrate dev
```

4. Start development server:
```bash
npm run dev
```

## Build

```bash
npm run build
```

## API Endpoints

- `/api/auth/*` - Authentication endpoints
- `/api/user/*` - User management
- `/api/tournaments/*` - Tournament operations
- `/api/custom-matches/*` - Custom match management
- `/api/wallet/*` - Wallet operations
- `/api/admin/*` - Admin operations
