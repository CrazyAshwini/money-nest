import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fromDatabase } from "@/lib/supabase/validation";
import { cloudRequestAllowed } from "@/lib/cloud-request";

export const runtime = "nodejs";
const allowed = new Set(["application/pdf","text/csv","image/png","image/jpeg","image/webp"]);

export async function POST(request: NextRequest) {
  if (!cloudRequestAllowed(request, true)) return NextResponse.json({error:"Request origin is not allowed."},{status:403});
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({configured:false,error:"Private document storage is not configured."},{status:503});
  const {data:{user},error} = await supabase.auth.getUser();
  if (error || !user || user.is_anonymous) return NextResponse.json({error:"Authentication required."},{status:401});
  if (Number(request.headers.get("content-length") || 0)>11*1024*1024) return NextResponse.json({error:"Maximum upload size is 10 MB."},{status:413});
  const form = await request.formData().catch(()=>null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.size || file.size>10*1024*1024 || !allowed.has(file.type)) return NextResponse.json({error:"Upload a PDF, CSV, PNG, JPEG, or WebP file up to 10 MB."},{status:400});
  const buffer = Buffer.from(await file.arrayBuffer());
  const header = buffer.subarray(0,12);
  const validSignature = file.type==="text/csv" ? !buffer.includes(0) : file.type==="application/pdf" ? header.subarray(0,5).toString()==="%PDF-" : file.type==="image/png" ? header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : file.type==="image/jpeg" ? header[0]===255 && header[1]===216 && header[2]===255 : header.subarray(0,4).toString()==="RIFF" && header.subarray(8,12).toString()==="WEBP";
  if (!validSignature) return NextResponse.json({error:"File contents do not match the selected type."},{status:400});
  const hash = createHash("sha256").update(buffer).digest("hex");
  const existing = await supabase.from("api_documents").select("*").eq("user_id",user.id).eq("file_hash",hash).maybeSingle();
  if (existing.data) return NextResponse.json({document:fromDatabase(existing.data),duplicate:true});
  const documentId = randomUUID();
  const storagePath = `${user.id}/${documentId}`;
  const uploaded = await supabase.storage.from("finance-documents").upload(storagePath,buffer,{contentType:file.type,upsert:false});
  if (uploaded.error) return NextResponse.json({error:"Private upload failed. Confirm the storage migration is applied."},{status:503});
  const metadata = {id:documentId,user_id:user.id,secure_storage_path:storagePath,file_name:file.name.slice(0,255),file_hash:hash,mime_type:file.type,byte_size:file.size};
  const saved = await supabase.from("documents").insert(metadata).select("*").single();
  if (saved.error) {
    await supabase.storage.from("finance-documents").remove([storagePath]);
    return NextResponse.json({error:"Document metadata could not be saved. Retry the upload."},{status:400});
  }
  return NextResponse.json({document:fromDatabase(saved.data)},{status:201,headers:{"Cache-Control":"no-store"}});
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({configured:false,error:"Private document storage is not configured."},{status:503});
  const {data:{user},error} = await supabase.auth.getUser();
  if (error || !user || user.is_anonymous) return NextResponse.json({error:"Authentication required."},{status:401});
  const documentId = request.nextUrl.searchParams.get("id");
  if (!documentId || !/^[0-9a-f-]{36}$/i.test(documentId)) return NextResponse.json({error:"A valid document ID is required."},{status:400});
  const {data:document,error:readError} = await supabase.from("documents").select("*").eq("id",documentId).eq("user_id",user.id).single();
  if (readError || !document) return NextResponse.json({error:"Document not found."},{status:404});
  const {data:signed,error:signError} = await supabase.storage.from("finance-documents").createSignedUrl(document.secure_storage_path,60,{download:document.file_name});
  if (signError) return NextResponse.json({error:"Could not open the private document."},{status:503});
  return NextResponse.json({url:signed.signedUrl,expiresIn:60,document:fromDatabase(document)},{headers:{"Cache-Control":"private, no-store"}});
}
