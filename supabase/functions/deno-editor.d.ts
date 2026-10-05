declare namespace Deno {
  namespace env {
    function get(name: string): string | undefined
  }

  function serve(handler: (request: Request) => Response | Promise<Response>): void
}

declare module 'https://esm.sh/@supabase/supabase-js@2' {
  export { createClient } from '@supabase/supabase-js'
}