import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://snnlprchqfjuodsykqzb.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNubmxwcmNocWZqdW9kc3lrcXpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExNjUyNzYsImV4cCI6MjA4Njc0MTI3Nn0.Zc3UshipgrByfXX0ohg3_aIBTxrf9mdrZqGxhz2q-Fw';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
