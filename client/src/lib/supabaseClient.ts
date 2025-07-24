import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://injrpzwzzxywxrlmapgu.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImluanJwend6enh5d3hybG1hcGd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTMxMDQwNTAsImV4cCI6MjA2ODY4MDA1MH0.ARo1FHiL7cSjl9PvjH1BEOSMwYWZwEsl3Vw0g8Ri5PI';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
