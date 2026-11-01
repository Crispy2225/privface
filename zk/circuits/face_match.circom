pragma circom 2.1.6;
include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

// Proves a relation between PRIVATE supplied descriptors, not ML inference or camera provenance.
template FaceMatch() {
    signal input account;
    signal input nonce;
    signal input enrollmentRoot;
    signal input limit;
    signal input modelTag;
    signal input enrolled[128]; // Signed INT16 values encoded as q + 32768.
    signal input probe[128];
    signal input blinding;
    signal output contextTag;

    component accountBits = Num2Bits(128);
    accountBits.in <== account;
    component nonceBits = Num2Bits(248);
    nonceBits.in <== nonce;
    component blindBits = Num2Bits(248);
    blindBits.in <== blinding;
    component nonzeroBlind = IsZero();
    nonzeroBlind.in <== blinding;
    nonzeroBlind.out === 0;
    modelTag === 1;
    component limitBits = Num2Bits(27);
    limitBits.in <== limit;
    component maxLimit = LessEqThan(27);
    maxLimit.in[0] <== limit;
    maxLimit.in[1] <== 67108864; // (2 * 4096)^2
    maxLimit.out === 1;
    component positiveLimit = IsZero();
    positiveLimit.in <== limit;
    positiveLimit.out === 0;

    component eBits[128];
    component pBits[128];
    signal squares[128];
    signal eMagnitude[128];
    signal pMagnitude[128];
    var distance = 0;
    var em = 0;
    var pm = 0;
    for (var i = 0; i < 128; i++) {
        eBits[i] = Num2Bits(16); eBits[i].in <== enrolled[i];
        pBits[i] = Num2Bits(16); pBits[i].in <== probe[i];
        squares[i] <== (enrolled[i] - probe[i]) * (enrolled[i] - probe[i]);
        eMagnitude[i] <== (enrolled[i] - 32768) * (enrolled[i] - 32768);
        pMagnitude[i] <== (probe[i] - 32768) * (probe[i] - 32768);
        distance += squares[i]; em += eMagnitude[i]; pm += pMagnitude[i];
    }
    component nonzeroE = IsZero(); nonzeroE.in <== em; nonzeroE.out === 0;
    component nonzeroP = IsZero(); nonzeroP.in <== pm; nonzeroP.out === 0;
    component match = LessEqThan(40);
    match.in[0] <== distance; match.in[1] <== limit; match.out === 1;

    component seed = Poseidon(4);
    seed.inputs[0] <== 20261021;
    seed.inputs[1] <== account;
    seed.inputs[2] <== modelTag;
    seed.inputs[3] <== blinding;
    component chain[16];
    for (var block = 0; block < 16; block++) {
        chain[block] = Poseidon(9);
        if (block == 0) { chain[block].inputs[0] <== seed.out; }
        else { chain[block].inputs[0] <== chain[block-1].out; }
        for (var j = 0; j < 8; j++) chain[block].inputs[j+1] <== enrolled[block*8+j];
    }
    enrollmentRoot === chain[15].out;
    component context = Poseidon(5);
    context.inputs[0] <== account;
    context.inputs[1] <== nonce;
    context.inputs[2] <== enrollmentRoot;
    context.inputs[3] <== limit;
    context.inputs[4] <== modelTag;
    contextTag <== context.out;
}
component main { public [account, nonce, enrollmentRoot, limit, modelTag] } = FaceMatch();
