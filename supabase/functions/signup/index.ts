import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

interface SignupRequest {
  username: string;
  display_name: string;
  password: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return Response.json(
        { error: "POST 요청만 허용됩니다." },
        { status: 405, headers: corsHeaders }
      );
    }

    try {
      const body: SignupRequest = await req.json();
      const username = String(body.username || "").trim().toLowerCase();
      const display_name = String(body.display_name || "").trim();
      const password = String(body.password || "");

      if (!username || !display_name || !password) {
        return Response.json(
          { error: "아이디, 이름, 비밀번호를 모두 입력해주세요." },
          { status: 400, headers: corsHeaders }
        );
      }

      if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
        return Response.json(
          { error: "아이디는 영문 소문자, 숫자, ., _, -만 사용해 3~30자로 입력해주세요." },
          { status: 400, headers: corsHeaders }
        );
      }

      if (password.length < 6) {
        return Response.json(
          { error: "비밀번호는 6자 이상 입력해주세요." },
          { status: 400, headers: corsHeaders }
        );
      }

      const internalEmail = `${username}@users.scheduler.invalid`;

      const { data: existingProfile, error: profileCheckError } =
        await ctx.supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("username", username)
          .maybeSingle();

      if (profileCheckError) {
        return Response.json(
          { error: profileCheckError.message },
          { status: 500, headers: corsHeaders }
        );
      }

      if (existingProfile) {
        return Response.json(
          { error: "이미 사용 중인 아이디입니다." },
          { status: 409, headers: corsHeaders }
        );
      }

      const { data: authData, error: authError } =
        await ctx.supabaseAdmin.auth.admin.createUser({
          email: internalEmail,
          password,
          email_confirm: true,
          user_metadata: { username, display_name },
        });

      if (authError) {
        return Response.json(
          { error: authError.message },
          { status: 400, headers: corsHeaders }
        );
      }

      if (!authData.user) {
        return Response.json(
          { error: "사용자 생성에 실패했습니다." },
          { status: 500, headers: corsHeaders }
        );
      }

      const { error: profileError } = await ctx.supabaseAdmin
        .from("profiles")
        .upsert(
          {
            id: authData.user.id,
            email: internalEmail,
            username,
            display_name,
            role: "user",
            approval_status: "pending",
          },
          { onConflict: "id" }
        );

      if (profileError) {
        await ctx.supabaseAdmin.auth.admin.deleteUser(authData.user.id);
        return Response.json(
          { error: profileError.message },
          { status: 500, headers: corsHeaders }
        );
      }

      return Response.json(
        {
          success: true,
          user: {
            id: authData.user.id,
            username,
            display_name,
          },
        },
        { status: 200, headers: corsHeaders }
      );
    } catch (error) {
      console.error(error);
      return Response.json(
        {
          error: error instanceof Error
            ? error.message
            : "회원가입 처리 중 오류가 발생했습니다.",
        },
        { status: 500, headers: corsHeaders }
      );
    }
  }),
};
