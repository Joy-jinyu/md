/**
 * emoji 补全用的常用表：GitHub 的短名（gemoji）→ emoji 字符。只收常用的两百来个，不是全量表；
 * 补全插入的是 emoji 字符本身，不写 `:短名:`，所以存下来的 Markdown 在哪儿都能显示。
 */

const TABLE = `
smile 😄|smiley 😃|grin 😁|laughing 😆|joy 😂|rofl 🤣|sweat_smile 😅|blush 😊|wink 😉|innocent 😇|slightly_smiling_face 🙂|upside_down_face 🙃
heart_eyes 😍|star_struck 🤩|kissing_heart 😘|yum 😋|stuck_out_tongue 😛|stuck_out_tongue_winking_eye 😜|sunglasses 😎|nerd_face 🤓|partying_face 🥳|hugs 🤗|thinking 🤔|shushing_face 🤫
zipper_mouth_face 🤐|neutral_face 😐|expressionless 😑|no_mouth 😶|smirk 😏|unamused 😒|roll_eyes 🙄|grimacing 😬|relieved 😌|pensive 😔|sleepy 😪|sleeping 😴
mask 😷|face_with_thermometer 🤒|dizzy_face 😵|exploding_head 🤯|confused 😕|worried 😟|astonished 😲|flushed 😳|pleading_face 🥺|cry 😢|sob 😭|scream 😱
sweat 😓|weary 😩|tired_face 😫|yawning_face 🥱|triumph 😤|rage 😡|angry 😠|skull 💀|poop 💩|clown_face 🤡|ghost 👻|alien 👽|robot 🤖
see_no_evil 🙈|hear_no_evil 🙉|speak_no_evil 🙊|+1 👍|thumbsup 👍|-1 👎|thumbsdown 👎|ok_hand 👌|v ✌️|crossed_fingers 🤞|wave 👋|clap 👏
raised_hands 🙌|pray 🙏|handshake 🤝|muscle 💪|point_up ☝️|point_down 👇|point_left 👈|point_right 👉|fist_raised ✊|punch 👊|writing_hand ✍️|eyes 👀|brain 🧠
heart ❤️|orange_heart 🧡|yellow_heart 💛|green_heart 💚|blue_heart 💙|purple_heart 💜|black_heart 🖤|white_heart 🤍|broken_heart 💔|two_hearts 💕|sparkling_heart 💖
star ⭐|star2 🌟|sparkles ✨|zap ⚡|fire 🔥|boom 💥|100 💯|dizzy 💫|speech_balloon 💬|thought_balloon 💭|zzz 💤|sweat_drops 💦|dash 💨
white_check_mark ✅|heavy_check_mark ✔️|ballot_box_with_check ☑️|x ❌|negative_squared_cross_mark ❎|warning ⚠️|no_entry ⛔|no_entry_sign 🚫|question ❓|exclamation ❗|bangbang ‼️|interrobang ⁉️
heavy_plus_sign ➕|heavy_minus_sign ➖|heavy_division_sign ➗|infinity ♾️|arrow_up ⬆️|arrow_down ⬇️|arrow_left ⬅️|arrow_right ➡️|arrows_counterclockwise 🔄|repeat 🔁|recycle ♻️
red_circle 🔴|orange_circle 🟠|yellow_circle 🟡|green_circle 🟢|large_blue_circle 🔵|purple_circle 🟣|black_circle ⚫|white_circle ⚪|new 🆕|free 🆓|cool 🆒|ok 🆗|sos 🆘|copyright ©️|registered ®️|tm ™️
bulb 💡|memo 📝|pencil2 ✏️|book 📖|books 📚|bookmark 🔖|pushpin 📌|round_pushpin 📍|paperclip 📎|link 🔗|lock 🔒|unlock 🔓|key 🔑
hammer 🔨|wrench 🔧|gear ⚙️|mag 🔍|bell 🔔|mega 📣|loudspeaker 📢|calendar 📆|date 📅|clipboard 📋|chart_with_upwards_trend 📈|chart_with_downwards_trend 📉|bar_chart 📊
file_folder 📁|open_file_folder 📂|package 📦|email 📧|envelope ✉️|inbox_tray 📥|outbox_tray 📤|computer 💻|keyboard ⌨️|iphone 📱|camera 📷|tv 📺|battery 🔋
hourglass ⌛|hourglass_flowing_sand ⏳|watch ⌚|alarm_clock ⏰|stopwatch ⏱️|moneybag 💰|dollar 💵|credit_card 💳|gem 💎|gift 🎁|tada 🎉|confetti_ball 🎊|balloon 🎈
trophy 🏆|1st_place_medal 🥇|2nd_place_medal 🥈|3rd_place_medal 🥉|dart 🎯|rocket 🚀|airplane ✈️|car 🚗|bike 🚲|ship 🚢|construction 🚧|rotating_light 🚨|checkered_flag 🏁|triangular_flag_on_post 🚩
house 🏠|office 🏢|school 🏫|hospital 🏥|earth_asia 🌏|earth_americas 🌎|globe_with_meridians 🌐|sunny ☀️|cloud ☁️|umbrella ☔|snowflake ❄️|rainbow 🌈|crescent_moon 🌙|ocean 🌊
seedling 🌱|evergreen_tree 🌲|deciduous_tree 🌳|cactus 🌵|four_leaf_clover 🍀|maple_leaf 🍁|fallen_leaf 🍂|rose 🌹|tulip 🌷|cherry_blossom 🌸|sunflower 🌻|mushroom 🍄
dog 🐶|cat 🐱|mouse 🐭|rabbit 🐰|fox_face 🦊|bear 🐻|panda_face 🐼|koala 🐨|tiger 🐯|lion 🦁|cow 🐮|pig 🐷|frog 🐸|monkey_face 🐵|chicken 🐔|penguin 🐧
bird 🐦|unicorn 🦄|bee 🐝|bug 🐛|butterfly 🦋|snail 🐌|turtle 🐢|snake 🐍|octopus 🐙|whale 🐳|dolphin 🐬|fish 🐟|crab 🦀|dragon 🐉
apple 🍎|banana 🍌|grapes 🍇|watermelon 🍉|strawberry 🍓|peach 🍑|cherries 🍒|lemon 🍋|tangerine 🍊|avocado 🥑|tomato 🍅|carrot 🥕|corn 🌽|hot_pepper 🌶️
bread 🍞|egg 🥚|hamburger 🍔|fries 🍟|pizza 🍕|ramen 🍜|sushi 🍣|rice 🍚|dumpling 🥟|cake 🍰|birthday 🎂|cookie 🍪|doughnut 🍩|icecream 🍦|candy 🍬
coffee ☕|tea 🍵|beer 🍺|beers 🍻|wine_glass 🍷|cocktail 🍸|tropical_drink 🍹|champagne 🍾
soccer ⚽|basketball 🏀|tennis 🎾|ping_pong 🏓|video_game 🎮|game_die 🎲|art 🎨|musical_note 🎵|notes 🎶|headphones 🎧|microphone 🎤|guitar 🎸|movie_camera 🎥|clapper 🎬
runner 🏃|baby 👶|boy 👦|girl 👧|man 👨|woman 👩|older_man 👴|older_woman 👵|technologist 🧑‍💻|ninja 🥷|santa 🎅|angel 👼|crown 👑|eyeglasses 👓|necktie 👔|ring 💍
cn 🇨🇳|us 🇺🇸|jp 🇯🇵|gb 🇬🇧
`;

export interface EmojiItem {
  name: string;
  emoji: string;
}

export const EMOJIS: EmojiItem[] = TABLE.trim()
  .split(/\n|\|/)
  .map((pair) => {
    const space = pair.indexOf(" ");
    return { name: pair.slice(0, space), emoji: pair.slice(space + 1) };
  });

/** 补全最多列几个。 */
const MAX_RESULTS = 8;

/** 输入到这么多个字符才也找「含有」的短名；更短时只找开头相同的（打 `:ok` 不该出来 `:broken_heart:`）。 */
const CONTAINS_FROM = 4;

/** 短名以输入开头的排前面，输入够长时其余含有输入的跟在后面；不分大小写。 */
export function matchEmoji(query: string): EmojiItem[] {
  const q = query.toLowerCase();
  if (q === "") return [];
  const starts = EMOJIS.filter((e) => e.name.startsWith(q));
  const contains = q.length >= CONTAINS_FROM ? EMOJIS.filter((e) => !e.name.startsWith(q) && e.name.includes(q)) : [];
  return [...starts, ...contains].slice(0, MAX_RESULTS);
}
