"""Builds the self-contained index.html from src/page.html, src/engine.js and src/clubs.json.

Run:  python3 build.py
"""
import json, pathlib

HERE = pathlib.Path(__file__).parent
SRC = HERE / "src"

# Major derbies and rivalries between clubs in the database. Joining a rival of a former club makes you a traitor.
RIVALRIES = """
Arsenal/Tottenham Hotspur; Manchester United/Manchester City; Manchester United/Liverpool; Liverpool/Everton;
Chelsea/Tottenham Hotspur; Chelsea/Arsenal; Newcastle United/Sunderland; Aston Villa/Birmingham City;
Leeds United/Manchester United; Nottingham Forest/Derby County; Brighton & Hove Albion/Crystal Palace;
West Ham United/Tottenham Hotspur; West Ham United/Millwall; Sheffield United/Sheffield Wednesday; Southampton/Portsmouth;
Wolverhampton Wanderers/West Bromwich Albion; Bristol City/Bristol Rovers; Ipswich Town/Norwich City; Cardiff City/Swansea City;
Stoke City/Port Vale; Blackburn Rovers/Burnley; Leicester City/Nottingham Forest;
Real Madrid/Barcelona; Real Madrid/Atlético Madrid; Barcelona/Espanyol; Sevilla/Real Betis; Athletic Bilbao/Real Sociedad;
Valencia/Levante; Celta Vigo/Deportivo A Coruña; Real Oviedo/Sporting Gijón;
Inter Milan/AC Milan; Inter Milan/Juventus; Roma/Lazio; Juventus/Torino; Genoa/Sampdoria; Napoli/Roma; Fiorentina/Juventus;
Borussia Dortmund/Schalke 04; Bayern Munich/Borussia Dortmund; Hamburger SV/Werder Bremen; 1. FC Köln/Borussia Mönchengladbach;
Hamburger SV/FC St. Pauli; Bayern Munich/1. FC Nürnberg; Union Berlin/Hertha BSC; VfB Stuttgart/Karlsruher SC;
Paris Saint-Germain/Marseille; Lyon/Saint-Étienne; Lens/Lille; Nice/Monaco; Rennes/Nantes;
Ajax/Feyenoord; Ajax/PSV Eindhoven; Groningen/Heerenveen;
Benfica/Sporting CP; Benfica/Porto; Porto/Sporting CP; Braga/Vitória de Guimarães;
Club Brugge/Anderlecht; Club Brugge/Cercle Brugge; Standard Liège/Anderlecht;
Celtic/Rangers; Heart of Midlothian/Hibernian; Dundee/Dundee United;
Galatasaray/Fenerbahçe; Beşiktaş/Galatasaray; Beşiktaş/Fenerbahçe; Trabzonspor/Fenerbahçe;
Olympiacos/Panathinaikos; PAOK/Aris; AEK Athens/Olympiacos;
Flamengo/Fluminense; Flamengo/Vasco da Gama; Corinthians/Palmeiras; São Paulo/Corinthians; Grêmio/Internacional;
Atlético Mineiro/Cruzeiro; Botafogo/Flamengo; Bahia/Vitória; Athletico Paranaense/Coritiba;
Boca Juniors/River Plate; Racing Club/Independiente; Rosario Central/Newell's Old Boys;
Estudiantes de La Plata/Gimnasia La Plata; San Lorenzo/Huracán; Talleres/Belgrano;
Al-Hilal/Al-Nassr; Al-Ittihad/Al-Ahli; Al-Hilal/Al-Ittihad;
LA Galaxy/Los Angeles FC; New York City FC/New York Red Bulls; Seattle Sounders FC/Portland Timbers; Inter Miami CF/Orlando City SC;
América/Guadalajara; Monterrey/Tigres UANL; América/Pumas UNAM; América/Cruz Azul; Atlas/Guadalajara;
Rapid Wien/Austria Wien; Sturm Graz/Grazer AK; FC Basel/FC Zürich; Grasshopper/FC Zürich; FC Copenhagen/Brøndby;
Slavia Prague/Sparta Prague; AIK/Djurgårdens IF; AIK/Hammarby IF; Djurgårdens IF/Hammarby IF; IFK Göteborg/GAIS;
Urawa Red Diamonds/Kashima Antlers; Gamba Osaka/Cerezo Osaka; Yokohama F. Marinos/Kawasaki Frontale
"""


def build_data():
    src = json.loads((SRC / "clubs.json").read_text(encoding="utf-8"))
    lidx = {l["id"]: i for i, l in enumerate(src["leagues"])}
    leagues = [[l["id"], l["name"], l["country"], l["level"]] for l in src["leagues"]]
    clubs = []
    for c in src["clubs"]:
        row = [c["name"], lidx[c["leagueId"]], c["tier"], c.get("academy", {}).get("rank", 0)]
        if c.get("reserveTeam"):
            row.append(1)
        clubs.append(row)
    names = {}
    for i, c in enumerate(src["clubs"]):
        names.setdefault(c["name"], []).append(i)
    rivals = []
    for pair in RIVALRIES.replace("\n", " ").split(";"):
        if not pair.strip():
            continue
        x, y = [n.strip() for n in pair.split("/")]
        assert x in names and y in names, f"unknown club in rivalry: {pair}"
        assert len(names[x]) == 1 and len(names[y]) == 1, f"ambiguous club name: {pair}"
        rivals.append([names[x][0], names[y][0]])
    return {"leagues": leagues, "clubs": clubs, "rivals": rivals}


def main():
    data = build_data()
    (SRC / "data.js").write_text("globalThis.CAREER_DATA=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    page = (SRC / "page.html").read_text(encoding="utf-8")
    if page:
        out = page.replace("/*__DATA__*/", (SRC / "data.js").read_text(encoding="utf-8")) \
                  .replace("/*__ENGINE__*/", (SRC / "engine.js").read_text(encoding="utf-8"))
        (HERE / "index.html").write_text(out, encoding="utf-8")
        print("index.html", len(out) // 1024, "KB")
    print(len(data["clubs"]), "clubs")


main()
