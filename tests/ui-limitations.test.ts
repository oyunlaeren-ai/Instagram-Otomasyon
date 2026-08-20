import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const followPage = fs.readFileSync(path.join("src", "renderer", "src", "pages", "FollowPage.tsx"), "utf8");
const unfollowPage = fs.readFileSync(path.join("src", "renderer", "src", "pages", "UnfollowPage.tsx"), "utf8");
const nonFollowersPage = fs.readFileSync(
  path.join("src", "renderer", "src", "pages", "NonFollowersPage.tsx"),
  "utf8"
);

describe("official api limitation copy", () => {
  it("disables follow actions and explains the Meta API limit", () => {
    expect(followPage).toContain("disabled={!connection.followSupported}");
    expect(followPage).toContain("Instagram'ın resmi API'si başka hesapları takip etmeyi desteklemiyor.");
    expect(followPage).toContain("Bu özellik mevcut resmi Meta/Instagram API sınırları nedeniyle kullanılamaz.");
    expect(followPage).not.toContain("Bu işlem mevcut Instagram API izinleriyle kullanılamıyor.");
    expect(followPage).toMatch(/if \(!connection\.followSupported\) \{\s*return;/);
  });

  it("shows follow queue rows as unsupported instead of waiting when follow is not supported", () => {
    expect(followPage).toContain("Web Otomasyonunu Başlat");
    expect(followPage).toContain("disabled={!webAutomation.session.connected}");
    expect(followPage).toMatch(
      /connection\.followSupported[\s\S]*\?[\s\S]*item\.lastActionAt[\s\S]*Instagram'ın resmi API'si başka hesapları takip etmeyi desteklemiyor\./
    );
    expect(followPage).toContain("disabled={!connection.followSupported}");
    expect(followPage).toContain('<span className="badge">Listede</span>');
  });

  it("disables unfollow actions and explains the Meta API limit", () => {
    expect(unfollowPage).toContain("disabled={!connection.unfollowSupported}");
    expect(unfollowPage).toContain("Instagram'ın resmi API'si başka hesapları takipten çıkarmayı desteklemiyor.");
    expect(unfollowPage).toContain("Bu özellik mevcut resmi Meta/Instagram API sınırları nedeniyle kullanılamaz.");
    expect(unfollowPage).not.toContain("Bu işlem mevcut Instagram API izinleriyle kullanılamıyor.");
    expect(unfollowPage).toMatch(/if \(!connection\.unfollowSupported\) \{\s*return;/);
    expect(unfollowPage).toContain("Web Otomasyonunu Başlat");
    expect(unfollowPage).toContain("disabled={!webAutomation.session.connected}");
  });

  it("does not present an empty non-followers table as zero users when lists are unsupported", () => {
    expect(nonFollowersPage).toContain("Takip etmeyenler listesi alınamıyor");
    expect(nonFollowersPage).toContain("Takip etmeyenler listesi resmi Instagram API tarafından sağlanmıyor.");
    expect(nonFollowersPage).toContain(
      "Instagram'ın resmi API'si takipçi/takip edilen kullanıcı listelerini uygulamaya sağlamıyor."
    );
    expect(nonFollowersPage).toContain("if (!listSupported)");
    expect(nonFollowersPage).toContain("Takip Ettiklerini Getir");
    expect(nonFollowersPage).toContain("Takipçilerini Getir");
    expect(nonFollowersPage).not.toContain("Bu liste mevcut API izinleriyle oluşturulamıyor.");
  });
});
