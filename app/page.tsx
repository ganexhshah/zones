export default function Home() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Backend API</h1>
      <p>Server is running on port 3001</p>
      <h2>Available Endpoints:</h2>
      <ul>
        <li>POST /api/auth/signup</li>
        <li>POST /api/auth/verify-otp</li>
        <li>POST /api/auth/login</li>
        <li>GET /api/user/profile</li>
        <li>PUT /api/user/profile</li>
        <li>GET /api/tournaments</li>
        <li>GET /api/wallet/balance</li>
      </ul>
    </div>
  );
}
