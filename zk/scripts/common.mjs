import { buildPoseidon } from 'circomlibjs'
export const SCHEME = 'poseidon-int16-v1'
export const CIRCUIT = 'face-match-v1'
export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
let pending
export async function hash(values) {
  const poseidon = await (pending ??= buildPoseidon())
  return poseidon.F.toObject(poseidon(values.map(BigInt))).toString()
}
export function accountField(id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new Error('Invalid account ID')
  return BigInt('0x'+id.replaceAll('-','')).toString()
}
export function encodeDescriptor(values) {
  if (values.length !== 128 || !values.every(Number.isFinite)) throw new Error('Invalid descriptor')
  const encoded = values.map(v => Math.round(v*4096)+32768)
  if (encoded.some(v => v<0 || v>65535) || encoded.every(v=>v===32768)) throw new Error('Descriptor out of range or zero')
  return encoded
}
export async function commitment(account, enrolled, blinding) {
  if (enrolled.length !== 128 || enrolled.some(v=>!Number.isInteger(v)||v<0||v>65535)) throw new Error('Invalid encoded descriptor')
  if (BigInt(blinding)<=0n || BigInt(blinding)>=2n**248n) throw new Error('Blinding must be a nonzero 248-bit secret')
  let root = await hash([20261021,account,1,blinding])
  for (let i=0;i<128;i+=8) root=await hash([root,...enrolled.slice(i,i+8)])
  return root
}
