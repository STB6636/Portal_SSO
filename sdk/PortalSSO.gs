/**
 * Portal SSO v2.4.0 — Google Apps Script Client SDK (Mode A: x-app-key)
 * สำหรับเว็บแอปย่อยบน Google Apps Script เพื่อเชื่อมต่อ Central REST API (portal-api)
 */

var PortalSSO = (function () {
  function getConfig_() {
    var props = PropertiesService.getScriptProperties();
    var apiUrl = String(props.getProperty('PORTAL_API_URL') || '').replace(/\/+$/, '');
    var appKey = String(props.getProperty('PORTAL_APP_KEY') || '');
    if (!apiUrl || !appKey) {
      throw new Error('กรุณาตั้งค่า PORTAL_API_URL และ PORTAL_APP_KEY ใน Script Properties');
    }
    return { apiUrl: apiUrl, appKey: appKey };
  }

  function callApi_(path, method, payload) {
    var cfg = getConfig_();
    var options = {
      method: method || 'get',
      muteHttpExceptions: true,
      headers: {
        'x-app-key': cfg.appKey,
        'Content-Type': 'application/json',
      },
    };
    if (payload !== undefined) {
      options.payload = JSON.stringify(payload);
    }
    var res = UrlFetchApp.fetch(cfg.apiUrl + path, options);
    var body = JSON.parse(res.getContentText() || '{}');
    if (res.getResponseCode() >= 400) {
      throw new Error(body.message || 'Portal API Error: ' + res.getResponseCode());
    }
    return body;
  }

  return {
    verifySsoToken: function (ssoToken) {
      return callApi_('/sso/verify', 'post', { ssoToken: ssoToken });
    },
    getAppRoles: function () {
      return callApi_('/app-roles', 'get');
    },
    getAuthorizedUsers: function (roleCode) {
      return callApi_('/authorized-users' + (roleCode ? '?role_code=' + encodeURIComponent(roleCode) : ''), 'get');
    },
    getPersonnelBatch: function (ids) {
      return callApi_('/personnel/batch', 'post', { ids: ids });
    },
    /** @deprecated ย้ายไปยังระบบเว็บแอปย่อยรถราชการแล้ว (HTTP 410 Gone) */
    getDrivers: function (dispatchableOnly) {
      return callApi_('/personnel/drivers' + (dispatchableOnly ? '?dispatchable_only=true' : ''), 'get');
    },
    getApprovers: function (officeId, departmentId) {
      var q = [];
      if (officeId) q.push('office_id=' + encodeURIComponent(officeId));
      if (departmentId) q.push('department_id=' + encodeURIComponent(departmentId));
      return callApi_('/personnel/approvers' + (q.length ? '?' + q.join('&') : ''), 'get');
    },
    /** @deprecated ย้ายไปยังแอปย่อยเครื่องราชฯ แล้ว ให้ใช้ getDecorationSource() แทน */
    getDecorationProfiles: function () {
      return callApi_('/personnel/decoration-profiles', 'get');
    },
    getDecorationSource: function (officeId, departmentId, personId) {
      var q = [];
      if (officeId) q.push('office_id=' + encodeURIComponent(officeId));
      if (departmentId) q.push('department_id=' + encodeURIComponent(departmentId));
      if (personId) q.push('person_id=' + encodeURIComponent(personId));
      return callApi_('/personnel/decoration-source' + (q.length ? '?' + q.join('&') : ''), 'get');
    },
  };
})();
