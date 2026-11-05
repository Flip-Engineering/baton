set -eu
export BEND="/mnt/nvme4tb/ci-runners/baton2-native-homelab/qualifications/instance-5e722392/toolchain-home/bin/bend"
export CC=/usr/lib/llvm-19/bin/clang
sh bend2/scripts/build-native.sh bend2/test/account-credits.bend .scratch/bend2/root-pr903-account-credits
.scratch/bend2/root-pr903-account-credits
