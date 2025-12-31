// This serverless function returns Supabase configuration values as JSON.
// In Vercel, environment variables SUPABASE_URL and SUPABASE_ANON_KEY should
// be defined in the project settings. When the client requests `/api/env`,
// this function responds with the URL and anon key. These values are used to
// initialize the Supabase client in the browser. DO NOT expose your
// service role key here—only the publishable anonymous key is needed for
// client operations.

export default async function handler(request, response) {
  // Use process.env to access environment variables set in Vercel.
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
  response.status(200).json({ supabaseUrl, supabaseAnonKey });
}