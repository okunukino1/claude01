// 既存の doPost(e) をこの形に差し替えてください。
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (body.action === 'pickupProgress') {
      return handlePickupProgress(body);
    }
    if (body.action === 'pickupLocation') {
      return handlePickupLocation(body);
    }
    if (body.action === 'spotPickupsSync') {
      return handleSpotPickupsSync(body);
    }

    const course = toCourseKey(body.course);
    if (!course) return respond({ ok: false, error: 'course is required' });

    if (body.action === 'save') {
      saveItems(course, body.items || []);
      return respond({ ok: true });
    }
    if (body.action === 'resetChecked') {
      resetChecked(course);
      return respond({ ok: true, lastResetDate: getTodayJP() });
    }
    return respond({ ok: false, error: 'unknown action: ' + body.action });
  } catch (err) {
    return respond({ ok: false, error: err.message });
  }
}
