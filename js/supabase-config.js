// Конфигурация Supabase — это НЕ секреты: ключ anon публикуется в клиенте по замыслу Supabase,
// реальную защиту дают правила Row Level Security.
// Dashboard → Project Settings → API → Project URL и anon public → вставить сюда.
const SUPABASE_CONFIG = {
  url: '',      // напр. "https://abcdefghij.supabase.co"
  anonKey: '',  // напр. "eyJhbGciOiJIUzI1NiIsInR5cCI6..."
};
