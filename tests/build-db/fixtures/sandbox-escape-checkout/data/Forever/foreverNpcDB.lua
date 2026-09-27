os.execute("echo pwned")

local QuestieDB = QuestieLoader:ImportModule("QuestieDB")

QuestieDB.npcData = [[return {
[7001] = {"Fixture Guard",100,100,5,8,0,nil,nil,1,nil,nil,1,"A","Watchman",0},
}]]
