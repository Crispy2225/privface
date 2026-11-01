import { quantize } from './face-match.ts'
export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
export type Parameters = Record<string, { C: string[]; M: string[][]; partial: number }>
export function poseidon(inputs: (string | number | bigint)[], params: Parameters): string {
  const p = params[inputs.length]; if (!p) throw new Error('Unsupported Poseidon arity')
  let state = [0n, ...inputs.map(BigInt)]
  const pow5 = (x: bigint) => { const square = x*x % FIELD; return square*square % FIELD*x % FIELD }
  for (let round=0; round<8+p.partial; round++) {
    state = state.map((x,i) => (x+BigInt(p.C[round*state.length+i])) % FIELD)
    state = state.map((x,i) => round<4 || round>=4+p.partial || i===0 ? pow5(x) : x)
    state = p.M.map(row => row.reduce((sum,m,i) => (sum+BigInt(m)*state[i]) % FIELD, 0n))
  }
  return state[0].toString()
}
export function encoded(values: ArrayLike<number>) { const q=quantize(values); try { return Array.from(q,x=>x+32768) } finally { q.fill(0) } }
export function accountField(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new Error('Invalid account ID')
  return BigInt('0x'+id.replaceAll('-','')).toString()
}
export function rootFor(account: string, values: number[], blind: string, params: Parameters) {
  let root=poseidon([20261021,account,1,blind],params)
  for (let i=0;i<128;i+=8) root=poseidon([root,...values.slice(i,i+8)],params)
  return root
}
