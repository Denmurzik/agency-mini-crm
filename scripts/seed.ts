// Демо-данные: npm run db:seed (переменные из .env.local). Повторный запуск пересоздаёт демо-лидов.
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { leads, leadTags, messages, type LeadSource, type LeadStatus } from "@/lib/db/schema";
import { ensureTags } from "@/lib/tags";

type Msg = { text: string; agoMin: number; source?: LeadSource };
type Demo = {
  name: string;
  contact: string | null;
  tgUsername?: string;
  source: LeadSource;
  status: LeadStatus;
  tags: string[];
  /** Сообщения от старого к новому; первое — исходный запрос. */
  messages: Msg[];
};

const H = 60;
const D = 24 * 60;

const DEMO: Demo[] = [
  {
    name: "Алина Захарова",
    contact: "@alina_zakh",
    tgUsername: "alina_zakh",
    source: "telegram",
    status: "new",
    tags: ["SMM", "Другое"],
    messages: [{ text: "Здравствуйте! Нужна помощь с оформлением страницы бренда одежды и контент-планом.", agoMin: 40 }],
  },
  {
    name: "Анна Соколова",
    contact: "@anna_sokolova",
    tgUsername: "anna_sokolova",
    source: "bot",
    status: "new",
    tags: ["Сайт", "горячий"],
    messages: [{ text: "Нужен сайт-визитка для студии йоги. Запуск хотим через месяц, до 5 страниц.", agoMin: 12 + 2 * H }, { text: "Добавлю: нужна онлайн-запись на занятия.", agoMin: 12 }],
  },
  {
    name: "Екатерина Власова",
    contact: "@kate_vlasova",
    tgUsername: "kate_vlasova",
    source: "telegram",
    status: "new",
    tags: ["Реклама"],
    messages: [{ text: "Подскажите, сколько стоит продвижение в Telegram-каналах для онлайн-школы?", agoMin: 5 * H }],
  },
  {
    name: "Дмитрий Орлов",
    contact: "+7 916 555-01-23",
    source: "telegram",
    status: "in_progress",
    tags: ["Реклама", "горячий"],
    messages: [
      { text: "Хочу настроить контекстную рекламу для автосервиса. Бюджет около 80 тыс. в месяц.", agoMin: 2 * D },
      { text: "Созвонились, жду от вас медиаплан до пятницы.", agoMin: 3 * H, source: "manual" },
    ],
  },
  {
    name: "Мария Ким",
    contact: "maria@kim-studio.ru",
    source: "manual",
    status: "in_progress",
    tags: ["SMM"],
    messages: [{ text: "Ведение Instagram и VK для кофейни, 3 поста в неделю + сторис. Обсудили на встрече.", agoMin: 1 * D + 4 * H }],
  },
  {
    name: "Олег Мартынов",
    contact: "+7 903 222-45-67",
    source: "bot",
    status: "in_progress",
    tags: ["Реклама", "SMM"],
    messages: [{ text: "Нужна рекламная кампания на запуск фитнес-клуба: таргет и блогеры.", agoMin: 6 * D }],
  },
  {
    name: "Игорь Беляев",
    contact: "@igor_belyaev",
    tgUsername: "igor_belyaev",
    source: "bot",
    status: "won",
    tags: ["Сайт", "повторный клиент"],
    messages: [
      { text: "Нужен интернет-магазин на Tilda, около 40 товаров, оплата картой.", agoMin: 5 * D },
      { text: "Договор подписали, оплату внесли.", agoMin: 2 * D, source: "manual" },
    ],
  },
  {
    name: "ООО «Вектор»",
    contact: "info@vektor-group.ru",
    source: "manual",
    status: "lost",
    tags: ["Сайт"],
    messages: [
      { text: "Редизайн корпоративного сайта, 15 страниц.", agoMin: 8 * D },
      { text: "Ушли к другому подрядчику: не устроили сроки.", agoMin: 4 * D, source: "manual" },
    ],
  },
  {
    name: "Светлана Николаева",
    contact: "+7 985 777-10-10",
    source: "manual",
    status: "new",
    tags: ["Сайт", "горячий"],
    messages: [{ text: "Лендинг для онлайн-курса по нутрициологии. Нужен конструктор оплаты и рассрочка.", agoMin: 7 * D }],
  },
  {
    name: "Павел Рогов",
    contact: "@pavel_rogov",
    tgUsername: "pavel_rogov",
    source: "bot",
    status: "won",
    tags: ["SMM", "повторный клиент"],
    messages: [
      { text: "Хотим продлить ведение соцсетей ещё на полгода.", agoMin: 9 * D },
      { text: "Спасибо, всё устраивает, давайте счёт.", agoMin: 8 * D + 3 * H },
    ],
  },
  {
    name: "Артём Лебедев",
    contact: "@artem_lebedev",
    tgUsername: "artem_lebedev",
    source: "bot",
    status: "lost",
    tags: ["Другое"],
    messages: [
      { text: "Узнать цены на SEO-продвижение интернет-магазина.", agoMin: 10 * D },
      { text: "Посчитали, для нас дороговато. Вернёмся позже.", agoMin: 9 * D + 2 * H },
    ],
  },
];

async function main() {
  const db = getDb();

  // Идемпотентность: сообщения и теги лидов удаляются каскадом.
  const removed = await db.delete(leads).where(eq(leads.isDemo, true)).returning({ id: leads.id });

  const now = Date.now();
  const at = (agoMin: number) => new Date(now - agoMin * 60_000);

  for (const demo of DEMO) {
    const first = demo.messages[0];
    const last = demo.messages[demo.messages.length - 1];
    const [lead] = await db
      .insert(leads)
      .values({
        name: demo.name,
        contact: demo.contact,
        request: first.text,
        source: demo.source,
        status: demo.status,
        tgUsername: demo.tgUsername ?? null,
        isDemo: true,
        createdAt: at(first.agoMin),
        updatedAt: at(last.agoMin),
        lastActivityAt: at(last.agoMin),
      })
      .returning();

    await db.insert(messages).values(demo.messages.map((m) => ({ leadId: lead.id, source: m.source ?? demo.source, text: m.text, createdAt: at(m.agoMin) })));

    const tagRows = await ensureTags(db, demo.tags);
    await db.insert(leadTags).values(tagRows.map((t) => ({ leadId: lead.id, tagId: t.id })));
  }

  console.log(`Демо-данные: удалено ${removed.length}, создано ${DEMO.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Не удалось залить демо-данные:", err);
    process.exit(1);
  });
