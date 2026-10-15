// Sends sign-in codes. With a Resend API key it emails them; without one (before Resend is set up)
// the code is only written to the Worker's log, which just the owner can read with `npx wrangler tail`.

export async function sendLoginCode(env, email, code)
{
  if (!env.RESEND_API_KEY)
  {
    console.log(`[login code] ${email}: ${code}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM || 'ope.cool arcade <arcade@ope.cool>',
      to: [email],
      subject: `${code} is your ope.cool arcade code`,
      text: `Your sign-in code is ${code}\n\nIt expires in 10 minutes. If you didn't ask for it, you can ignore this email.`,
      html: `<p>Your sign-in code is</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px">${code}</p>
        <p>It expires in 10 minutes. If you didn't ask for it, you can ignore this email.</p>`,
    }),
  });
  if (!res.ok)
    throw new Error(`Resend failed: ${res.status} ${await res.text()}`);
}
