-- 2人チャットでも名前が付いているルームはグループとして修正する。
-- isGroup=false で members が 2人いるルームのうち、
-- 名前がメンバーの displayName と一致しないもの（= 手動で名前を付けたグループ）を true に変更。
UPDATE "Room"
SET "isGroup" = true
WHERE "isGroup" = false
  AND (SELECT COUNT(*) FROM "RoomMember" WHERE "RoomMember"."roomId" = "Room"."id") >= 2
  AND NOT EXISTS (
    SELECT 1 FROM "RoomMember"
    JOIN "User" ON "User"."id" = "RoomMember"."userId"
    WHERE "RoomMember"."roomId" = "Room"."id"
      AND "User"."displayName" = "Room"."name"
  );
