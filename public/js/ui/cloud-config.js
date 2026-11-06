/*
 * cloud-config.js — 云服务公开配置（publicConfig）
 * ==================================================================
 * 这四个值由 workbuddy_cloud_service 开通云服务时返回，是**公开**配置：
 *   · publishableKey 只标识"哪个应用"，本身不带任何权限，服务端会做 Origin 校验；
 *   · endpoint 必须是当前应用的发布域名，不能猜、不能从 location 推导。
 *
 * ⚠️ 重新发布到**不同域名**时，这里必须同步更新（否则云服务会因 Origin 不匹配拒绝请求）。
 * ⚠️ 任何长期密钥、环境 id、服务端密钥都不得出现在本文件里。
 */
export const cloudConfig = {
  resourceId: 'wbcs_kvYzPLFWRvaRj0z5NbQFhd',
  endpoint: 'https://mcu-lab-00765.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_idgNd5XrGxitlULXTLilAO_mwnvZYnEBRxBrqJidBhZuFGnxzoY3zCx'
};

/** 是否已配置云服务（未配置时全部功能回退到本机服务端） */
export const cloudConfigured = () =>
  !!cloudConfig.endpoint && !!cloudConfig.publishableKey;
