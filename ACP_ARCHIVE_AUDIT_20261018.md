# ACP archive audit: completed video outputs and archive deliveries

Session `acp-archive-audit-20261018`. Read-only audit of existing farm receipts and archive readback evidence. No source changed, no media transferred, no live job touched.

## Pins

- Worktree: `/home/atari2036/render-fframes-port-20261016/worktrees/acp-archive-audit-20261018`
- Actual HEAD: `db037ddc1019cd53890c029174a351dfde5f1011`
- Assignment base: `db037ddc1019cd53890c029174a351dfde5f1011`; **matches, so the base is not stale**
- Farm evidence root: `/mnt/nvme4tb/automated-content-pipeline-homelab-20261002`

## What was checked

Read `status.json`, `receipt.json`, `protocol.json` and delivery file hashes for every completed farm job in `jobs/` and `lanes/gpu1/jobs/`; walked the archive readback directory; compared each protocol delivery record to the validated receipt; checked for duplicate master hashes. No media was downloaded and no job was claimed, released, or modified.
Hash provenance: master and receipt SHA-256 values below are copied from the validated receipt/protocol records and cross-checked for equality; media bytes were not re-hashed except the canary readback copy.

## Result

- Completed video deliveries in the farm records: **512**.
- Completed video deliveries in the audit window (2026-10-16T00:00:00Z to 2026-10-18T10:07:34Z): **62**.
- **62/62** have a `protocol.json` delivery record with `archive_dir`, per-file SHA-256, and a queue `verified` timestamp.
- **1/62** have an independent archive object readback directory (the FFrames canary only). The other **61** have farm/queue delivery evidence only, not an independent object readback.
- Completed videos with no delivery record: **0**. Duplicate master SHA-256 values across all 512 completed video deliveries: **0**.
- Failed jobs with only partial local `.mp4` files in the window: **8** (listed below). They are not completed and have no delivery; they are not publication gaps.

### Evidence classes (kept separate)

1. **Farm completion**: `status.json` `state=complete`; video `receipt.json` has `output_sha256`, frame count and duration. This is the render/finish fact, not archive proof.
2. **Archive delivery record**: `protocol.json` `state=delivered`, `archive_dir=farm/<job>/`, `delivery.files[]` with SHA-256, and a `verified` timestamp written after the pipeline queue accepted the archive push and confirmed the delivered hashes. This is the existing receipt evidence.
3. **Independent object readback**: a local copy read back from the archive with a matching media hash. Only the FFrames canary has this (`archive-readback/1018-030606-.../`).
4. **Remote readback by this audit**: not performed. The archive is private and this session has no GitHub credentials: `gh auth status` reports no login; anonymous `https://github.com/flip-engineer/automated-content-pipeline-video-studies-archive` and its API return HTTP 404; the LFS batch API returns HTTP 401 `Requires authentication`; `git ls-remote` prompts for a username. No transfer or publication was attempted.

## Completed video deliveries, window (window start 2026-10-16T00:00:00Z)

Receipt path per row: `$FARM/<lane>/protocol-<job>/receipt.json`; protocol path is the same directory with `protocol.json`. Archive path per row: `farm/<job>/` (the `archive_dir` recorded in `protocol.json`).
For every video row, the delivery-record master SHA-256 equals the receipt `output_sha256` (checked in the scan); the FFrames canary uses `video.sha256` instead of `output_sha256`.

| # | job | lane | finished UTC | prepared pipeline commit | master SHA-256 | receipt.json SHA-256 | object readback |
|---|---|---|---|---|---|---|---|
| 1 | `1018-030606-fframes_gpu1_two_frame_canary_b6` | g1 | 2026-10-18T10:07:34.290752Z | `b2a2cd887148b443d432f58f52676d857e5973d3` | `51b6d6190b0ef10b2e35a0eb70512dfeb09fc3648354cf51f7d7aeb2ef2f89cd` | `8546ff6356f0035edc311977e021d067fb57bceadc5ebfda5e1ae1ae9a791290` | canary dir, media SHA match |
| 2 | `1017-002840-render_oneshot2_74` | g0 | 2026-10-18T03:06:42.153141Z | `8d27246d805f6818a96e802bbeec90d70733f93b` | `017611dca8d96686d715e6182b2db9978307f9e0dfaafb9a87b2f5093c9a4510` | `4a6676396bce7df6fd066741549f4eef13b4f19d5efb7eca601c73b84e214fd0` | none; delivery record only |
| 3 | `1016-210224-render_deadlabour_68` | g1 | 2026-10-17T23:10:47.649920Z | `1bb9a4704ee4edeb2ac81c8103066ddb96d5f567` | `be5227535329a0e1627ca4b2478acd1153743cc035c03ce1af1d79063ebfe899` | `585909a0c88eb18a7194ee20d5f8a708d4de9c1f104ffde35b48a9de17214e80` | none; delivery record only |
| 4 | `1016-204444-render_deadlabour_b_68` | g1 | 2026-10-17T23:07:36.786651Z | `1dd26779f799ccef688c5c21838e1d67f9b26c05` | `a627b927c6d19a99f7f43378b9f7eb27216159b297760dfdf1b201746b65f5cc` | `18668ec9d65f352102176eab07e98f37a3d879903c1585f68a79d05e3b20794c` | none; delivery record only |
| 5 | `1016-204441-render_deadlabour_68` | g1 | 2026-10-17T23:03:35.579800Z | `129604155277aab2eeb9d3f93335ba53afcdb0a5` | `406acdb09ac62cf934ebfc13f162104b4f7508897f65c6f96a5f97e083b476a8` | `3f828101f2b24cede27bbc10ca058291bd88cadb8708e53cad7ada6d906baff4` | none; delivery record only |
| 6 | `1016-201633-render_footnote_a_93` | g1 | 2026-10-17T23:00:07.027575Z | `54e62d313c7f79d4499b2662d2ed92109029ab23` | `3d5fc9412ae6d97d02067f8ffe8509d73cc4bc6e2e9109d634888ee1b5839246` | `5a2cba24f5cdee950603f5897fa4f623f8015f6626f3c14a1fdcbfb35ddcbbaa` | none; delivery record only |
| 7 | `1016-200812-render_gravediggers_v4b_37_5` | g1 | 2026-10-17T22:55:19.753887Z | `20444ddcb3c1a382cc5c8712de26d27755d02bc1` | `ab169abd6f8273f3d5a5600bcad22c0607f41a33efd409bbcfa4f232ddcedb41` | `5b253d8b2da3685942a3b590866c0a218c7bf3b2fe4c76a943e1d25a5132a269` | none; delivery record only |
| 8 | `1016-101647-render_atrest4_76_4` | g0 | 2026-10-17T22:48:12.343143Z | `85484971106d3d7fab7e91da65303cb1151d3471` | `86d1aca996fdd06d5b4e12263b4335892ebbb105733715af7406b214087b4480` | `6753519a46ba0683e885d4999821ce897074421453f31907feed149ab4047a73` | none; delivery record only |
| 9 | `1016-200809-render_gravediggers_v4a_37_5` | g1 | 2026-10-17T22:36:36.570763Z | `59d22813700a680c15a6325466e777864b654bac` | `67a5ad4dedec03f6f7050dfedec4b3d2e733812e14d75e7af4898442abda0cb9` | `b181d0c7db83e0cfe4379cb0f29952d216c6cd2a4f29692c62ebf04455a4eb61` | none; delivery record only |
| 10 | `1016-193958-render_ownfuture2_64` | g1 | 2026-10-17T22:19:14.091272Z | `47a598661b6b56a9e00acede585fc9914de53d26` | `b76d466bcb6071713b454b6d67e62625cc54f6f36166db508b9d7b96942f2892` | `49e6c10037737c861438a7a04638f1cff9323513c38c38e52dbab75dbb84a06d` | none; delivery record only |
| 11 | `1016-193906-render_gary2036_112` | g1 | 2026-10-17T22:16:11.712628Z | `84ded5d6dbbf0dcb733c36c4882b3f51c9f46969` | `88dfa63606e678ee667a0bec61364baea34c75a572e78a06bc7f899bb7124465` | `619b090aee7223b90fc5bc6de67503800fea1792703e581ac19ffa8cfa11efe9` | none; delivery record only |
| 12 | `1016-173004-bench_human8_nosemouth_c4it3_14` | g1 | 2026-10-17T22:08:41.374322Z | `a0b493cd76ce0ae4df286846799ee4ca2adf4d7f` | `5ed07d587bed897ec7d119aafbc78f6edcec6081b4bc832ff7ead521acdfe199` | `b7d1c790e5bb3c81a7582e845e123252875e4b5c2cc60a4c2c21604fc2558b70` | none; delivery record only |
| 13 | `1016-164030-bench_skinopt_c5it3_6_plates` | g1 | 2026-10-17T21:51:02.913650Z | `3b3147dc57349d986d8d42f9f956a26546c9b464` | `02d4af3ffac49abca342869f02a0e13350919728a0b6d14ab2fd525aeaa28e39` | `dae947b2e18b80e08b6d77d7d0e60d1aac102e2ef3db91828e94f9a548c2ab68` | none; delivery record only |
| 14 | `1016-153150-bench_cloth8_c10it1_briefs_b_2_p` | g1 | 2026-10-17T21:42:23.317743Z | `c8b5b2ed3de9ba10b01f90f0329b049bdbd80af0` | `311f3e6d7545d9bafcf2d31ea169303a2565b75242a5c5d4c043492b54e1faae` | `f6b1a772778d2f2c53b6a8ee9fee1a72cb4696acf07ac95844b4532ef64a969a` | none; delivery record only |
| 15 | `1016-122831-productive_forces_c22_take_t_new` | g1 | 2026-10-17T21:36:53.585060Z | `a2c9d41e2a5c1918b8ca84fd4674ddcad3b71138` | `1ec27ccc570afb8f1bf653e15e475c4822e28d9a04cd705bc95c9be138078d00` | `8a2dec413e5b2ee18864239e265eee9c1d154df2bb8d16ccd1bfad9901617b65` | none; delivery record only |
| 16 | `1016-111854-render_bread_75_5_72` | g1 | 2026-10-17T21:34:58.982202Z | `23e017a1b84bb603a1399715058688baf09296f5` | `699e0c1a764d010beeff7ced9c295e846c5cc49b2940c52149488bdac31170de` | `de44a3d517038b4a598e630af5315cbebfb636a0500e635d15da40c5778113aa` | none; delivery record only |
| 17 | `1016-111706-render_rejuvenation3_68` | g1 | 2026-10-17T18:59:18.506043Z | `caed4a1b5a9253027f19a1f82e427c7b8ba7bb6b` | `e17e859719b11ff82ad0e531050e3715dca0e9bbb3e92af4bb394a8d94b545df` | `586d7cf0d2f8068ad89a30c20f51b783d5a1d9cd51735d83a154344829a59548` | none; delivery record only |
| 18 | `1016-112454-the_chasm_v1_take_b_full_render` | g0 | 2026-10-17T09:54:05.099004Z | `be390b84776b83c4309630c586e18f1c53445931` | `155a9c1bdafb0a5ec4342f734fd18eea6a7c1deac479978cfbc995749ca74188` | `46de6938a78d9f331b6bf072ac04ccf2e70d6cf7f9ca75db291c910824863ac1` | none; delivery record only |
| 19 | `1016-112218-render_bread_75_5_72` | g0 | 2026-10-17T07:02:23.532925Z | `a52906851571c96079b70b1b48d56382dd9ff7dc` | `fad52891c0989e1ad4ce4180002bdf5f3322fa725beb0afe1196ad442d357a60` | `f3f627c7aba267af3c8d655047e0d66a1ed3409c26d72e2dbdeba318f024112f` | none; delivery record only |
| 20 | `1016-111959-unrecognizable_v1_take_b_full_re` | g0 | 2026-10-17T07:00:24.740609Z | `693434ef8cf4cf5e1e10fbd4668dc2be83a1e296` | `9742f7c5569b5c86e7761009ec36c4d42a45d479a76e73124cd30667e199f8fc` | `b93e0729213c675b73877b3851654aa5a0b02274bd2c528184002c9aa57f0f5b` | none; delivery record only |
| 21 | `1016-110521-the_chasm_v1_take_a_full_render` | g0 | 2026-10-17T06:58:32.848121Z | `e67fd169c16f6c6e499d4b3f2c58d63c9e42844e` | `e6d3c06113762958b42e9f8488d2575337b097a8bced6f570e15d2182c745ee4` | `f057c21eb74bb78e13c447c769f989eef4464c6516c6ea9ffb9d58d1de582b66` | none; delivery record only |
| 22 | `1016-111019-unrecognizable_v1_take_a_full_re` | g1 | 2026-10-17T01:33:16.894118Z | `a95e1460a718ca010637799892864ce344a6e688` | `62049f0fed78bafab26fa28f81a1cc3546f00d609cec98e54cfc8d3ff9789892` | `d838422aa25555f9fe85bdb548c96565e7de975760455b639f0ed2b514a85d65` | none; delivery record only |
| 23 | `1016-110417-one_shot_cure_v1_take_c` | g0 | 2026-10-17T00:08:10.529122Z | `87dbfc059ea5776d04834331098f3cb1ba1c97b5` | `1647b0208caa38a7cdd94259a098402bc821e9162dda3510fab81db4a73ec891` | `42217734bc2c431865f3f08800f5a93a68f10c66239f06fcde7b4dd0f694eae8` | none; delivery record only |
| 24 | `1016-105734-one_shot_cure_v1` | g0 | 2026-10-16T23:59:47.958932Z | `c367ed84ee9fe004d1d19d926321c3242fff5444` | `fe4879aed33e38029250696d77eaf9491cca9e70a3113f6adf010d067107b985` | `d66d604d2639a9bed270ee2ead9d6709bf84a55630e3a5a766eb59c595cb24a9` | none; delivery record only |
| 25 | `1016-110251-bench_human8_integ_c6it2_23_plat` | g1 | 2026-10-16T23:37:03.564235Z | `b501cde118a4e93217d84e2c5b2065ecf2dd960b` | `4d3a7866c8052d2351ddfd7dcf72a8d0eab683bd2de03633ad42d4dbdcd95d59` | `64c546b7fe700616d52a15c62a2ba5c28d2c257d4b6e354c5bdc460d065da131` | none; delivery record only |
| 26 | `1016-105730-by_authority_v2_take_b_the_new_s` | g0 | 2026-10-16T23:32:51.812627Z | `6b2ac19d193cb9300544a67792e75c6cbbac58ea` | `5f19b3b03b820bc057c8fd507f310d5113ce81246a33d8e29c6b6c72746f9be3` | `d80ec97dfd4e7e82ab685cee9b0d10ed033067fbda6b897dfc68d4c2db763f24` | none; delivery record only |
| 27 | `1016-105728-one_shot_cure_v1` | g0 | 2026-10-16T23:24:21.087826Z | `59a311653d0fa6358d06aea15177e058633abc57` | `b575ff146e6e60b83701a466f6d267db21b29e95149110ca5b8076e1cdb7e7a9` | `d678eba8f66338dd564c028821280c9fbbd38b4db2173b3348fb191ac7c365de` | none; delivery record only |
| 28 | `1016-105126-render_meltdown8_202` | g1 | 2026-10-16T22:01:02.269263Z | `5ff1111d2e4b0c3c977abcd7c44428d32d34d806` | `e93ed8f59bd3c3431d9dc60c9e79e599ec80bb41162bd016a7396dcac9d50511` | `8de030dbd22bd9b339e35844a931da965e73b12267936b32e9120ee8a8caed8a` | none; delivery record only |
| 29 | `1016-105131-render_meltdown8_ab_sdf_202` | g0 | 2026-10-16T21:58:38.186717Z | `6faa0c32694566da9e93bbbae8d156f7f518b1fd` | `5a3957b9bc12ce333a02191d770a23b9ec0a2de2e6e4fb6a7ab41cafeac76330` | `0255c4953d15b52ebe6b2f2184f14c35aa744515fbd5a746c17292e8038d7673` | none; delivery record only |
| 30 | `1016-080837-bench_human8_anat8h_it23_14_plat` | g1 | 2026-10-16T18:21:21.625116Z | `aa391827e3242404f80e10d9363383a541c0b7f7` | `de2bd95cc847a41611bd5193fc2e51dfe970aa44007f7d6e8a13a79798401a6f` | `3e5d9df2739d347f0ad5fa82398274b01a003518204f6a42a22201dc80a9ad18` | none; delivery record only |
| 31 | `1016-013701-giant_v9_r2_the_fist_rebuilt_wri` | g0 | 2026-10-16T17:25:11.787712Z | `96233dd9fa4ca0cfe6fdfcf7a242daeae036bf43` | `e4ac9e75b494276e05744063dbdd1da201be844e31eb18968e3a20c380043dba` | `b90f3d4295a23f9c4110cb2443f42f437a69dc9bd836c4e0c6b6f009b6afad0c` | none; delivery record only |
| 32 | `1016-013447-render_deadlabour_68` | g0 | 2026-10-16T17:21:25.644903Z | `07ad9aef57f4d5c309faa81594ab47a423c6bf9d` | `6fbcc663e1b4bd8a978abdcd22df9a4d5599f24f5b02af7debe5013eec9d4ca5` | `8ff04264dc6ac689530ba8e91cd6dd3f4ddbc003441eadb8a99e1386507aea37` | none; delivery record only |
| 33 | `1016-004323-the_core_v2_finish_core_a_with_h` | g0 | 2026-10-16T17:19:37.089928Z | `ffb051ccd310618e58a545ee5875f9ec1cbbd9eb` | `5c7d3682637fe5cb7b7f1b10feae3654a6bc7b4cd2c426d0e46ed482cafe95a6` | `dba66cc016fcedf4f2d063ff5830df02badb153cc91d842b7b9909ecce3154ff` | none; delivery record only |
| 34 | `1016-003919-bench_giant_v9_h2_13_plates` | g0 | 2026-10-16T14:04:39.740504Z | `c9244e93ec46179748a221e36d86cb55397c8a71` | `dc6081cb105a550f39c38f458cc8f6bb5bc3fbc272c0f92baf5d95425c5399bc` | `f6a5854b67b31c8d5725e35dd1d263ccd286b4ce3bcb845a250c81333fe37c92` | none; delivery record only |
| 35 | `1016-043745-render_empire5_c_90` | g1 | 2026-10-16T11:23:39.361545Z | `6bf7419e549dfe50bb67bac27c331b3a33ad29c4` | `825477276f0bb0c7e9d55d876ed711f22b73f74c5e3ab866582529ff88adcf4d` | `65803fe118610b4b02b005bbb3209c5e58270af153545a01c7109897c9b5f392` | none; delivery record only |
| 36 | `1015-234807-render_gravediggers_y_37_5` | g1 | 2026-10-16T11:10:29.580894Z | `910c470d7525354e2d5b0634df1cfe7f16a1a7bc` | `17eb6141a0c4f49ad182e0a943001c7d9dbbfd2cf54c6de509e5cbc6798f7345` | `cfd46f2142539b88aeaae19d0d5e432b07fec59e3a3eb5cb39590bdcf01ab8cd` | none; delivery record only |
| 37 | `1015-234805-render_gravediggers_x_37_5` | g1 | 2026-10-16T10:56:00.237017Z | `1bc731ee3a700c8b41eee27c5bfb841a7ce09d3c` | `cb571856210a0138ed2e4cfd6fae55f81457259536a2fd92a9d0199afa79740d` | `27baa5ed3883aae41f20ce369221193988d78c19786755258a7d270c42d121b3` | none; delivery record only |
| 38 | `1015-224934-render_productive2_d_92_128` | g1 | 2026-10-16T10:41:17.579454Z | `cd707417ab00d9f7c35e3610d977416b17369d3c` | `00fb7352f28a79546155ea1fa0773d2f34ceb930e114a37e65b3dcead9396ce5` | `a964a9c390e1ade6b4acdba06272912d69b2bfbc640fda88b16e216a4697df67` | none; delivery record only |
| 39 | `1015-234810-render_gravediggers_z_37_5` | g0 | 2026-10-16T09:19:26.609928Z | `549a74e1f96f80ac96b95c779a9085b90ad6e44f` | `b919d12d9fb5ad7769fc8318b0dbda0d5eee2418e2b8f0e36e20a98d2e8fc982` | `87d1eb8e135ac095e6c9ddba349a2e03825262f5c83f2a0f0b22acf6a5c38541` | none; delivery record only |
| 40 | `1015-234649-night_of_25_october_v2_c21_the_m` | g0 | 2026-10-16T09:03:34.502819Z | `2efeb42c85b6490befc1ffdf7517aabf5d900421` | `b84357153a07dc876cb90284ec16990f7a8629e55e016a0cc639bf180d1a5af2` | `6332d75482a404c3c67474bcadd9e5a0e4d5db6f49eb1e8a3cd9fb0517da85dd` | none; delivery record only |
| 41 | `1015-224941-render_productive2_f_92_128` | g0 | 2026-10-16T09:00:51.795898Z | `26ff92551d1a97c5d2a49b86a0e49ea3ab238d53` | `fd919ac877b14958716d6b2e32652ad0814ae573cef9dc10e0305a25b84faf76` | `90508710f8a4db06fc76a8d2bc8cc01885f66b4c02437f1e97b8f688745a252c` | none; delivery record only |
| 42 | `1015-224938-render_productive2_e_92_128` | g0 | 2026-10-16T08:57:36.476182Z | `f4d598d1fc7c21ddf916e81fee27874cfb44ceb6` | `48845d5934caca99daa9adac077b849c9bada351b2a11c96d6c46f1660b10da8` | `4c1a8be6469d7ee8a45e2c098ded986c0c3c4942d704de5432241500f7b54b7c` | none; delivery record only |
| 43 | `1015-222220-by_authority_v1_final_take_b_wit` | g0 | 2026-10-16T08:36:59.951573Z | `36b2fca761944ab98b9b5fb2c3f6d84004fba2af` | `13bdfabce35925803aa7d73cb619f1b8b55b61cd1ca928b8c648f66c686628d0` | `397cfbbf480c6f9726df97a6cad66ad48baacfe611e49b76be7aa7c419045c77` | none; delivery record only |
| 44 | `1015-222529-bench_eyes_it14_engine_v11_3_pla` | g1 | 2026-10-16T07:36:47.161425Z | `2193dd22d4535e617b5d918d370783762807f1b9` | `afd5ab290364b1afb41501b9f801858064b5f35c42aadb3f6c889594010fece7` | `c6bd4ede450bb7eac889c45b87b91f2121ad016f0352fdec5ff5bb0b78453e7a` | none; delivery record only |
| 45 | `1015-220246-bench_human8_motion3o_6_plates` | g0 | 2026-10-16T07:13:24.580879Z | `5f5a1a89ae221dfdd051c98580763c1d9b3d17ae` | `b4e10d0f051670df2d1ee05d7173492ea638f5882cc2d0f7b6b7be875c349c0b` | `8af20e768875258e5b04e932eb7c6f2377ead84e25c7c7a99d56321836795d97` | none; delivery record only |
| 46 | `1015-215004-bench_human8_face7_it19_13_plate` | g0 | 2026-10-16T07:05:51.353369Z | `fc4a7dbf698282180c1b01739a64289fbfed542b` | `f5b11353ca9a244db77bc80c79f01b008a196171581ffe51bbd9178eda7c0167` | `69922d6a6a6fca2d207581dd16c2bc2faec8bb4aa7246ee0ba1c842c32471a9a` | none; delivery record only |
| 47 | `1015-193944-bench_fabric7_c6_it3_16_plates` | g0 | 2026-10-16T06:43:37.335395Z | `60c3962e973ea419327d9beb64afd6253edfc9d9` | `bd75670a4fb20a781f17319cd2268dda763f1d405cbc6e6966dc1e7c8ef9fc4e` | `51e44d8295fb34d32461ca6e126d7e3a7446c70867e85181c4c8db763a1db6ae` | none; delivery record only |
| 48 | `1015-200253-bench_human8_face7_it18_9_plates` | g1 | 2026-10-16T05:50:29.441823Z | `d7d4f6db3c26a2b130569ad6ae00c10668cb3140` | `742a8f581d2dcc0368e47d85b1d6949eae3c1baeb6b233e2dd5997015c0cd5ac` | `59551cdff97654cd1a8ca2dfe7dbe16b23c2d101df6fcee0ae81fe6985c38db2` | none; delivery record only |
| 49 | `1015-185752-at_rest_c21_v_d_the_impact_big_t` | g0 | 2026-10-16T05:40:47.130775Z | `9e4ff306253442adc1d5acd4848452856118c5fd` | `286e7f503d18def3de15b55ff67c24093c71b82d7934fa7d2d0fd4faefeacc92` | `08591cf4c3169010e20dd1ba2be478dd957e74bc5ed5d9933ac6aa5a321b3ded` | none; delivery record only |
| 50 | `1015-184316-bench_human8_anat8h_it20_6_plate` | g0 | 2026-10-16T04:45:05.636428Z | `1ccf05bbb17b62f8b64d7da672d1ed7adc609b08` | `b25f707401bdfee369e2f38184c1529a130a88bd62e7441056683a25ef30c9c8` | `8e630bdf3869ce679872dc9aa9bb0a35ed608b4797eacff96e8ab4bf61ef6ff8` | none; delivery record only |
| 51 | `1015-184131-night_of_25_october_v2_c21_draft` | g0 | 2026-10-16T04:42:36.129557Z | `dafc8dbc8d6268406c6e55f5ce8db9bb8a91243f` | `39838660d14726d33f8d0c87f2c8d6e316401c5aca81ee1fa06f2cfa932dda9e` | `93b659fea1a4b9ac0dcea5cd17b1275ba40d21c33a2bfa0e98c688c291a390ac` | none; delivery record only |
| 52 | `1015-183432-render_intelligence2_171_645_120` | g0 | 2026-10-16T04:41:00.565087Z | `d92c5b6f5ccfd7b16b1777cdaf2074cd18fb441d` | `592e2cd3146f75b1a3e36cc3fb20e4d34f97a7b7cfa8b45446086652cd920664` | `030500955309ce88ece11602bd38dca8fcc29b5c3008c89ce161132e71ab9c18` | none; delivery record only |
| 53 | `1015-183421-render_empire5_c_90` | g0 | 2026-10-16T04:28:17.651416Z | `b0aa447c3d2efe8a3be5751ffbadaaab9a506a5e` | `c68d1f1b061dfeeaa909a021ac1d90d2bfc9a22ae6e82de785069f839b4ff2f5` | `3f63b48c4c7f0b94190865657d7dd3e1501e0f3fc58f783217b4b67ea357762e` | none; delivery record only |
| 54 | `1015-165648-render_deadlabour_s2_68` | g1 | 2026-10-16T01:41:14.440885Z | `58f6a34e690c33b1be8dfe8a2cb376d1d43f2fe4` | `95c35fc05c5bbae29e82889a4fcbde619005a6317f8634eb186f26205a71a752` | `a079c2db5007bf1d0fc8d835580b8fdb29ba02aaf8915de0605457ed6d9c3054` | none; delivery record only |
| 55 | `1015-165645-render_deadlabour_s1_68` | g1 | 2026-10-16T01:39:32.345475Z | `e97e69cad7cc2af9fc44d4a01f78f5caffc690a5` | `260590aaec276b8c1406678a517cc6cf1ee5e9c85e3565c6ab097183d0f8e255` | `d441f42622dd6c570a2565a52597bb6de3874a7144f4902220ee23811602ce9d` | none; delivery record only |
| 56 | `1015-161728-render_bank3_90_5` | g1 | 2026-10-16T01:37:49.130988Z | `cdf5a08eb1ff32a4b98b0a04dd44285b82d4d897` | `42a11e2df2b7431286320d33c09aa719913f357247ff3c26acf30899053dc744` | `43c2c77568ab6781261a50b6a048d01b1fc5113b39b7c7acadc81770ca2efe3b` | none; delivery record only |
| 57 | `1015-171853-giant_v9_r1_the_giant_s_fist_reb` | g0 | 2026-10-16T00:48:07.233662Z | `68f86885158310cf04ccf68a66a2a78e2d1ad9de` | `5c714804ece6d7a6f346f83266dc5dd01c1e9078108ea5ce7959eef1880818e1` | `22d6762422e8c882387fa2d74f980c12272afafdbfcf7fd3766f3b4a9050eec6` | none; delivery record only |
| 58 | `1015-165658-render_deadlabour_s3_68` | g0 | 2026-10-16T00:44:53.532757Z | `99fcae8251cadf8c9bcc92b4cb240dfb876120aa` | `788dc8f796aabd7ebea7748524e463d7da3629c99ded4e46564677946ac24091` | `74bf7f3d9e8972e88339411f2092c7179a6c4281ad43d181b33f48cd476dcfd3` | none; delivery record only |
| 59 | `1015-165653-render_bank3_y_98_5` | g0 | 2026-10-16T00:43:07.256245Z | `421c22c59fc4e225ce47ff7b7333559000e8705e` | `8c047bb94932d2d0778094282f08d3db801231b8a86999388be572d08cbf80e6` | `50cd76179a92a0c54990e7e842b7e0f94d5b0b0334a44e68a1a949d290d5093d` | none; delivery record only |
| 60 | `1015-165650-render_bank3_x_98_5` | g0 | 2026-10-16T00:40:15.083705Z | `ead80a0c323a00281fc681724463e41395df274b` | `b0448807ca04c6dcfe3af20f76a13b7a3ea079c2af4ca4e42f6dae41ce318e6b` | `d14f946931ff8d7702009e68d8b1895edad9f3efca70c57cb33a0ce2055e7c77` | none; delivery record only |
| 61 | `1015-133612-the_core_c20_takes_retry_person` | g0 | 2026-10-16T00:37:04.977191Z | `8998f1751835aec96e9354e3f4b47101ae87c69a` | `edc7fb37eef54e0df33933ee2aaac801c61f09cb72fcf9b3399fdfbd57466e3b` | `86ae86c5b490709aa4887cbd16ae16555e9ab74a751d1fe2f15c20dd9ff5a2db` | none; delivery record only |
| 62 | `1015-133608-the_core_c20_takes_retry_person` | g0 | 2026-10-16T00:11:07.264198Z | `12a294a5458a9367b21900322f35dddce4ead808` | `12cb8929412f93b61a60f5319c5e587154942830ee51f5b340a2c292453b54a7` | `67644d838344bffe664e0c6eea3011a4751d884641380035eca4d0757b5d2df2` | none; delivery record only |

Full machine-readable rows (including full receipt/protocol paths, protocol SHA-256, archive URL, `verified` timestamp, share-copy hashes, frame counts and object-readback hashes): `ACP_ARCHIVE_AUDIT_20261018.json`.

### Readback exemplar (the only completed video with independent object readback)

- Job: `1018-030606-fframes_gpu1_two_frame_canary_b6` (2 frames, 64x64, 995 bytes).
- Source pin: pipeline `b2a2cd887148b443d432f58f52676d857e5973d3`; FFrames source `b6e93716c852c522f087f40732b13b441f63bdc2`; binary SHA-256 `af75363c61f4685179cf20a2ef6ad3d60206263a5307d564e09adfe86f83651e`.
- Delivery: `protocol.json` state `delivered`, archive `farm/1018-030606-fframes_gpu1_two_frame_canary_b6/`, delivered 2026-10-18T10:07:42Z, queue verified 2026-10-18T10:07:46Z.
- Readback directory: `/mnt/nvme4tb/automated-content-pipeline-homelab-20261002/archive-readback/1018-030606-fframes_gpu1_two_frame_canary_b6/`.
- Readback `fframes-canary.mp4` SHA-256 `51b6d6190b0ef10b2e35a0eb70512dfeb09fc3648354cf51f7d7aeb2ef2f89cd` = receipt/`delivery.files` hash.
- Readback `receipt.json` SHA-256 `8546ff6356f0035edc311977e021d067fb57bceadc5ebfda5e1ae1ae9a791290` = job `receipt.json` hash; renderer receipt `b1643317d020e01ddb70011a6fe6a0767f09509b8420c67684c5390c706bc4d8`.

## Asset job `1016-162807-anat8_head_it25_face9_at_sk5_hd8`

**Not a video.** This is a face/person Blender stills asset job: 18 PNG and 12 EXR stills plus JSON/sidecar files; it is not a finished video and is not counted in the video totals above.

- Status: `ok`, ended `2026-10-18T10:16:08Z`, exit codes `[0]`, peak RSS `38.76` GiB, GPU `GPU-1a60290b-b538-1ac7-9a81-3978d3b12c60`, Blender `5.2.2 LTS`.
- Status record: `status.json` state `complete`, phase `validated`, finished `2026-10-18T10:16:11.089233+00:00`; `status.json` SHA-256 `80bb8e957cf85f6a2c3350135aaddc32627f92b74aad71d5e27e272e83c0c342` (path in JSON audit). Receipt `ended` is `2026-10-18T10:16:08Z`.
- Prepared commit, recorded separately from `receipt.repo.commit`: `5a4143a9091e7655b1caf2b038c7cbbff13c4968`. `receipt.repo.commit` is `null`; the pin is carried by `request.json` (`commit`/`ref`), `protocol.json` (`pipeline_job.pipeline_commit`), `receipt.json` top-level `commit`, and `receipt.source_verification.commit`.
- Generated script executed: `videos/blender/person7_job.farm-fine-39e32c05b675b9a3.py`; SHA-256 `068477e64ea39fd74b30e0c2c196bdc5211d7b8bfa87783ab63f91e92f861a1e`. It is an untracked farm-fine variant in the job checkout, not a tracked file at the pin.
- Tracked source script at the pin: `videos/blender/person7_job.py`; SHA-256 `e7888d1355d84eae6cb62815d732da2d1f55d88481243b9e793c3a044f0ea4c9`.
- Adapter: `videos/scripts/gpu_job.farm.py` SHA-256 `464e8063b38dae5979cc5d53e1f44e81f32de8aab882da374eee7458ba1679ca` = receipt `adapter_sha256` `464e8063b38dae5979cc5d53e1f44e81f32de8aab882da374eee7458ba1679ca`.
- Receipt: `/mnt/nvme4tb/automated-content-pipeline-homelab-20261002/jobs/protocol-1016-162807-anat8_head_it25_face9_at_sk5_hd8/receipt.json` SHA-256 `9fc9b0cf731ed02b81f463693f6dbd30b2d7093abd97ef04828f3e004aa226e1`; protocol: `/mnt/nvme4tb/automated-content-pipeline-homelab-20261002/jobs/protocol-1016-162807-anat8_head_it25_face9_at_sk5_hd8/protocol.json` SHA-256 `ebd700e5a98dc3443401db323dc7191f8387192f66ea96413700a96d9b4c1125`; request: `/mnt/nvme4tb/automated-content-pipeline-homelab-20261002/jobs/protocol-1016-162807-anat8_head_it25_face9_at_sk5_hd8/request.json` SHA-256 `8478d382648460636f88a1397dd9f612a831e7e54090a04a12f3dabf71780f60`.
- Delivery: `protocol.json` state `delivered`, archive `farm/1016-162807-anat8_head_it25_face9_at_sk5_hd8/`, delivered 2026-10-18T10:20:07Z, queue verified 2026-10-18T10:20:11.408023+00:00; 52 files, 227571449 bytes; 18 PNG + 12 EXR. Receipt lists 49 output files; delivery adds `receipt.json`, `log.txt`, `farm-dependencies.json`. Overlapping file hashes match; mismatches: none.
- Independent object readback for this asset: **none found**; the archive is private and unauthenticated readback is unavailable. The existing queue delivery record is the only archive evidence.
- Decision: provenance is truthful and already represented by an existing numbered delivery record. No new publication, duplicate delivery or media transfer was performed.

## Failed jobs in the window (not finished; excluded from the video count)

| job | lane | finished UTC | phase | protocol state |
|---|---|---|---|---|
| `1017-002747-render_meltdown8_222` | g0 | 2026-10-18T01:07:37.089350Z | rendering | waiting_for_recovery |
| `1016-101644-render_atrest3_76_4` | g1 | 2026-10-17T21:33:08.008985Z | rendering | (none) |
| `1016-111456-render_machines_e1_b_40_116` | g0 | 2026-10-17T11:18:27.713866Z | rendering | waiting_for_recovery |
| `1016-111451-render_machines_e1_a_40_116` | g1 | 2026-10-17T01:34:34.423476Z | rendering | waiting_for_recovery |
| `1016-101644-render_atrest3_76_4` | g0 | 2026-10-16T21:19:56.893293Z | rendering | waiting_for_recovery |
| `1016-101647-render_atrest4_76_4` | g1 | 2026-10-16T21:19:56.865880Z | rendering | waiting_for_recovery |
| `1015-170428-bench_giant_v9_h1_17_plates` | g0 | 2026-10-16T00:45:01.912019Z | rendering | (none) |
| `1015-163306-bench_giant_v9_h0_17_plates` | g0 | 2026-10-16T00:37:13.184368Z | rendering | (none) |

These jobs have partial local `.mp4` files but no validated complete output and no archive delivery. They are not publication gaps and were not modified.
Some ids also have a later completed record (for example `1016-101647-render_atrest4_76_4` failed at 21:19Z but completed at 22:48Z). The failed row is the superseded attempt, not a second incomplete delivery.

## Publication gaps and actions

- Completed-video publication gap that can be closed without duplicating a delivery: **none identified**. Every completed video output (512/512; 62/62 in the window) already has an archive delivery record with hashes. There is no validated completed payload absent from the archive.
- Specific non-gap limitation: independent remote LFS object readback is unavailable in this session (no credentials; private archive). The queue `verified` timestamp is push/delivery confirmation, not an independent object read.
- Action taken: audit and report only. **No media transfer, no republish, no job claim/release, no source or live-job change.**

## Evidence index

- Report: `ACP_ARCHIVE_AUDIT_20261018.md`
- Machine-readable audit: `ACP_ARCHIVE_AUDIT_20261018.json`
- Canary readback media: `/mnt/nvme4tb/automated-content-pipeline-homelab-20261002/archive-readback/1018-030606-fframes_gpu1_two_frame_canary_b6/fframes-canary.mp4` SHA-256 `51b6d6190b0ef10b2e35a0eb70512dfeb09fc3648354cf51f7d7aeb2ef2f89cd`
- Canary readback receipt: same directory, `receipt.json` SHA-256 `8546ff6356f0035edc311977e021d067fb57bceadc5ebfda5e1ae1ae9a791290`
- Asset delivery file hashes: all 52 are in `protocol.json` `pipeline_job.delivery.files` and are reproduced in the JSON audit.

