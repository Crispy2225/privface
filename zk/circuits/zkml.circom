pragma circom 2.1.6;
include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../generated/model.circom";

// floor((signed accumulator + 128) / 256), including negative half ties.
// Offset is divisible by 256. Bit decomposition constrains quotient/remainder.
template Rounded(relu) {
    signal input accumulator;
    signal output value;
    component bits=Num2Bits(32);
    bits.in <== accumulator + 2147483648 + 128;
    var quotient=0;
    for(var b=8;b<32;b++) quotient += bits.out[b]*(2**(b-8));
    if(relu==1) value <== (quotient-8388608)*bits.out[31];
    else value <== quotient-8388608;
}

template PrivateInference() {
    signal input pixels[1024];
    signal output embedding[16];
    component pixelBits[1024];
    for(var p=0;p<1024;p++) {
        pixelBits[p]=Num2Bits(8); pixelBits[p].in <== pixels[p];
    }
    var w1[32][1024]=weights1(); var b1[32]=bias1(); var w2[16][32]=weights2(); var b2[16]=bias2();
    component hidden[32]; component hiddenBits[32];
    for(var h=0;h<32;h++) {
        var acc=b1[h];
        for(var p=0;p<1024;p++) acc+=w1[h][p]*(pixels[p]-128);
        hidden[h]=Rounded(1); hidden[h].accumulator <== acc;
        hiddenBits[h]=Num2Bits(16); hiddenBits[h].in <== hidden[h].value;
    }
    component outputLayer[16]; component outputBits[16];
    for(var o=0;o<16;o++) {
        var acc=b2[o];
        for(var h=0;h<32;h++) acc+=w2[o][h]*hidden[h].value;
        outputLayer[o]=Rounded(0); outputLayer[o].accumulator <== acc;
        embedding[o] <== outputLayer[o].value;
        outputBits[o]=Num2Bits(16); outputBits[o].in <== embedding[o]+32768;
    }
}

template ZkML() {
    signal input account; signal input nonce; signal input enrollmentRoot;
    signal input bindingVersion; signal input operation; signal input limit;
    signal input modelTag; signal input policyTag;
    signal input pixels[1024]; signal input enrolled[16]; signal input blinding;
    signal output contextTag;
    component accountBits=Num2Bits(128); accountBits.in <== account;
    component nonceBits=Num2Bits(248); nonceBits.in <== nonce;
    component versionBits=Num2Bits(32); versionBits.in <== bindingVersion;
    component limitBits=Num2Bits(32); limitBits.in <== limit;
    component blindBits=Num2Bits(248); blindBits.in <== blinding;
    component nonzero[5];
    var values[5]=[account,nonce,bindingVersion,limit,blinding];
    for(var i=0;i<5;i++) {nonzero[i]=IsZero(); nonzero[i].in <== values[i]; nonzero[i].out===0;}
    (operation-1)*(operation-2) === 0;
    modelTag === modelIdentity();
    component inference=PrivateInference();
    for(var p=0;p<1024;p++) inference.pixels[p] <== pixels[p];
    component ranges[16]; signal squares[16]; signal magnitudes[16];
    var distance=0; var magnitude=0;
    for(var i=0;i<16;i++) {
        ranges[i]=Num2Bits(16); ranges[i].in <== enrolled[i];
        // Enrollment (operation=1) MUST commit this model's actual output.
        (2-operation)*(enrolled[i]-32768-inference.embedding[i]) === 0;
        squares[i] <== (enrolled[i]-32768-inference.embedding[i])*(enrolled[i]-32768-inference.embedding[i]);
        magnitudes[i] <== (enrolled[i]-32768)*(enrolled[i]-32768);
        distance+=squares[i]; magnitude+=magnitudes[i];
    }
    component nonzeroTemplate=IsZero(); nonzeroTemplate.in <== magnitude; nonzeroTemplate.out===0;
    component match=LessEqThan(40); match.in[0] <== distance; match.in[1] <== limit; match.out===1;
    component seed=Poseidon(4);
    seed.inputs[0] <== 2026110101; seed.inputs[1] <== account;
    seed.inputs[2] <== modelTag; seed.inputs[3] <== blinding;
    component chain[2];
    for(var block=0;block<2;block++) {
        chain[block]=Poseidon(9);
        if(block==0) chain[block].inputs[0] <== seed.out;
        else chain[block].inputs[0] <== chain[block-1].out;
        for(var j=0;j<8;j++) chain[block].inputs[j+1] <== enrolled[block*8+j];
    }
    enrollmentRoot === chain[1].out;
    component context=Poseidon(9);
    context.inputs[0] <== 2026110101; context.inputs[1] <== account;
    context.inputs[2] <== nonce; context.inputs[3] <== enrollmentRoot;
    context.inputs[4] <== bindingVersion; context.inputs[5] <== operation;
    context.inputs[6] <== limit; context.inputs[7] <== modelTag; context.inputs[8] <== policyTag;
    contextTag <== context.out;
}
component main { public [account,nonce,enrollmentRoot,bindingVersion,operation,limit,modelTag,policyTag] } = ZkML();
