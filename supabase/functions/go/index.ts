import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// CONFIGURATION
const WHITE_PAGE = 'https://aipoet15-source.github.io/candy-world/';
const OFFER_LINKS = [
  'https://candyai.gg/home2?via=phpxf',
  'https://landing.candynetwork.ai/elara?via=phpxf',
  'https://candyai.gg/ai-anime?via=phpxf'
];

// IP / ASN Detection constants (synchronize with vt/index.ts if needed)
const DC_ASN = ['AS14061','AS16509','AS15169','AS8075','AS13335','AS20940','AS54113','AS46606','AS36352','AS40676','AS7922','AS209','AS396982','AS35415','AS35540','AS24940'];
const BOT_UA = ['bot','spider','crawl','headless','chrome-lighthouse','googlebot','bingbot','yandex','slurp','duckduckbot','facebot','ia_archiver'];

function isBot(ua: string) {
  const l = ua.toLowerCase();
  return BOT_UA.some(p => l.includes(p));
}

function isDC(asn: string) {
  if (!asn) return false;
  return DC_ASN.some(p => asn.startsWith(p));
}

serve(async (req: Request) => {
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  
  const ip = req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0].trim() || '0.0.0.0';
  const ua = req.headers.get('user-agent') || '';
  const referrer = req.headers.get('referrer') || '';
  const lang = req.headers.get('accept-language')?.split(',')[0] || '';
  
  // Geolocation and ASN (provided by Supabase Edge Runtime headers)
  const country = req.headers.get('x-region') || ''; // Note: x-region or cf-ipcountry
  const city = req.headers.get('x-city') || '';
  const asn = req.headers.get('x-asn') || ''; // Custom header usually passed by proxy or cloudflare

  const url = new URL(req.url);
  const campaign = url.searchParams.get('utm_campaign') || 'go_direct';

  // 1. Check known_checkers table
  const { data: checkerByIP } = await sb
    .from('known_checkers')
    .select('id')
    .eq('ip', ip)
    .maybeSingle();

  const botUA = isBot(ua);
  const dcASN = isDC(asn);
  
  // High-certainty checker detection
  const isChecker = !!(checkerByIP || botUA || dcASN);

  // 2. Write to visit_logs (direct mode)
  await sb.from('visit_logs').insert({
    ip, asn, country, city, ua, referrer, lang,
    is_checker: isChecker,
    campaign: campaign + '_direct',
    fp: 'direct_302'
  });

  // 3. SECURE REDIRECT
  const target = isChecker 
    ? WHITE_PAGE 
    : OFFER_LINKS[Math.floor(Math.random() * OFFER_LINKS.length)];

  return Response.redirect(target, 302);
});
